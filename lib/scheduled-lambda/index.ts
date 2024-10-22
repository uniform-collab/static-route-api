import { promises as fs } from "fs";
import * as nodePath from "path";
import { z, ZodSchema } from "zod";
import * as tmp from "tmp";
import * as rimraf from "rimraf";
import * as mkdirp from "mkdirp";
import { S3Client } from "@aws-sdk/client-s3";
import S3SyncClient, { TransferMonitor } from "s3-sync-client";
import {
  CloudFrontClient,
  CreateInvalidationCommand,
} from "@aws-sdk/client-cloudfront";

async function request<TExpectedType>(
  origin: string,
  uri: string,
  apiKey: string,
  schema: ZodSchema<TExpectedType>
): Promise<TExpectedType> {
  const res = await fetch(`${origin}${uri}`, {
    headers: { "x-api-key": apiKey },
  });

  return schema.parseAsync(await res.json());
}

export async function handler() {
  const tmpDir = nodePath.dirname(tmp.tmpNameSync());
  rimraf.sync(nodePath.join(tmpDir, "**"));
  console.log("Emptied ", tmpDir);

  const target = tmp.dirSync({ unsafeCleanup: true });
  console.log("Created ", target.name);

  try {
    await renderAndSync(target.name);
  } catch (err) {
    console.error("Failed to render and sync", err);

    throw err;
  } finally {
    console.log("Cleaning up ", target.name);

    target.removeCallback();
  }
}

async function renderAndSync(dir: string) {
  if (
    !process.env.BUCKET_NAME ||
    !process.env.DISTRIBUTION_ID ||
    !process.env.UNIFORM_PROJECT_ID ||
    !process.env.UNIFORM_API_KEY
  ) {
    throw new Error(
      "Missing one or more of BUCKET_NAME, DISTRIBUTION_ID, UNIFORM_PROJECT_ID, UNIFORM_API_KEY"
    );
  }

  const origin = process.env.UNIFORM_ORIGIN || "https://uniform.app";
  const projectId = process.env.UNIFORM_PROJECT_ID;
  const apiKey = process.env.UNIFORM_API_KEY;

  const res = await request(
    origin,
    `/api/v1/locales?projectId=${projectId}`,
    apiKey,
    z.object({ results: z.array(z.object({ locale: z.string() })) })
  );

  const locales = res.results.map((result) => result.locale);

  const { projectMaps } = await request(
    origin,
    `/api/v1/project-map?projectId=${projectId}`,
    apiKey,
    z.object({
      projectMaps: z.array(
        z.object({ id: z.string(), default: z.boolean().optional() })
      ),
    })
  );

  const projectMapId =
    projectMaps.find((map) => map.default)?.id ?? projectMaps[0]?.id;

  if (typeof projectMapId !== "string") {
    throw new Error("No project map found");
  }

  const { nodes } = await request(
    origin,
    `/api/v1/project-map-nodes?projectId=${projectId}&projectMapId=${projectMapId}&expanded=true`,
    apiKey,
    z.object({
      nodes: z.array(
        z.object({
          id: z.string(),
          path: z.string(),
          locales: z
            .record(z.string(), z.object({ path: z.string().optional() }))
            .optional(),
        })
      ),
    })
  );

  const pathsToRender = nodes
    .map(({ locales: nodeLocales, path }) =>
      path.includes(":locale")
        ? locales.map((locale) =>
            (nodeLocales?.[locale]?.path ?? path).replace(":locale", locale)
          )
        : path
    )
    .flat(1)
    .filter((path) => !path.includes(":"));

  console.log(`Writing to ${dir}...`);

  for (const path of pathsToRender) {
    const res = await request(
      origin.replace(".app", ".global"),
      `/api/v1/route?projectId=${projectId}&state=64&path=${encodeURIComponent(
        path
      )}`,
      apiKey,
      z.union([
        z.object({ type: z.literal("notFound") }),
        z.object({
          type: z.literal("composition"),
          matchedRoute: z.string(),
          dynamicInputs: z.record(z.string(), z.string()),
          compositionApiResponse: z.unknown(),
        }),
        z.object({ type: z.literal("redirect") }),
      ])
    );

    if (res.type === "composition") {
      const pathBase64 = Buffer.from(path).toString("base64url");
      const fileName = `${dir}/${projectId}/${pathBase64}/64.json`;
      const content = JSON.stringify(res);

      mkdirp.sync(nodePath.dirname(fileName));
      await fs.writeFile(fileName, content, "utf8");
      console.log(`Wrote ${fileName}`);
    }
  }

  const client = new S3Client();

  const { sync } = new S3SyncClient({ client });

  const monitor = new TransferMonitor();
  monitor.on("progress", (progress) => console.log(progress));

  await sync(
    `${dir}/${projectId}`,
    `s3://${process.env.BUCKET_NAME}/${projectId}`,
    {
      del: true,
      monitor,
      commandInput: () => ({
        ContentType: "application/json",
      }),
    }
  );

  const cloudfrontClient = new CloudFrontClient();

  console.log("Invalidate distribution", process.env.DISTRIBUTION_ID);

  await cloudfrontClient.send(
    new CreateInvalidationCommand({
      DistributionId: process.env.DISTRIBUTION_ID,
      InvalidationBatch: {
        CallerReference: Date.now().toString(),
        Paths: {
          Quantity: 1,
          Items: ["/*"],
        },
      },
    })
  );
}
