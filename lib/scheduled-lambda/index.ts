import { promises as fs } from "fs";
import * as nodePath from "path";
import * as tmp from "tmp";
import * as rimraf from "rimraf";
import * as mkdirp from "mkdirp";
import {
  DeleteObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import S3SyncClient, { TransferMonitor } from "s3-sync-client";
import { CloudFrontClient } from "@aws-sdk/client-cloudfront";
import { DynamoDBClient, QueryCommand } from "@aws-sdk/client-dynamodb";
import { Logger, makeLogger } from "./logger";
import { request } from "./request";
import {
  Dependencies,
  dependenciesSchema,
  localesResponseSchema,
  projectMapNodesResponseSchema,
  projectMapsResponseSchema,
  routeResponseSchema,
} from "./typesAndSchemas";
import { prepareEnv } from "./env";
import { tagsFromDependencies, updateTags } from "./tags";
import { invalidate } from "./invalidation";

const s3client = new S3Client();
const dynamoClient = new DynamoDBClient();
const cloudfrontClient = new CloudFrontClient();

const makeObjectKey = (projectId: string, path: string) =>
  `${projectId}/${Buffer.from(path).toString("base64url")}/64.json`;

export async function handler(event: unknown) {
  const logger = makeLogger();

  let dependencies: Dependencies | undefined;
  if (
    typeof event === "object" &&
    event !== null &&
    !Array.isArray(event) &&
    "body" in event &&
    typeof event.body === "string"
  ) {
    try {
      dependencies = dependenciesSchema.parse(JSON.parse(event.body));
    } catch {
      logger.info("Body could not be parsed to dependencies, will render all");
    }
  }

  const tmpDir = nodePath.dirname(tmp.tmpNameSync());
  rimraf.sync(nodePath.join(tmpDir, "**"));
  logger.info("Emptied ", tmpDir);

  const target = tmp.dirSync({ unsafeCleanup: true });
  logger.info("Created ", target.name);

  try {
    if (dependencies) {
      await renderAffected(dependencies, logger);
    } else {
      await renderAndSyncAll(target.name, logger);
    }

    logger.info("Cleaning up ", target.name);
    target.removeCallback();

    return {
      statusCode: 200,
      body: JSON.stringify({ dependencies, logs: logger.logs }),
      headers: {
        "content-type": "application/json",
      },
    };
  } catch (err) {
    logger.error(
      "Failed to render and sync",
      err instanceof Error ? err.message : undefined
    );

    logger.info("Cleaning up ", target.name);
    target.removeCallback();

    return {
      statusCode: 200,
      body: JSON.stringify({ dependencies, logs: logger.logs }),
      headers: {
        "content-type": "application/json",
      },
    };
  }
}

async function renderAndSyncAll(dir: string, logger: Logger) {
  const {
    mappingTableName,
    bucketName,
    distributionId,
    origin,
    projectId,
    apiKey,
  } = prepareEnv();

  const res = await request(
    origin,
    `/api/v1/locales?projectId=${projectId}`,
    apiKey,
    localesResponseSchema
  );

  const locales = res.results.map((result) => result.locale);

  const { projectMaps } = await request(
    origin,
    `/api/v1/project-map?projectId=${projectId}`,
    apiKey,
    projectMapsResponseSchema
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
    projectMapNodesResponseSchema
  );

  const pathsToRender = nodes
    .flatMap(({ locales: nodeLocales, path }) =>
      path.includes(":locale")
        ? locales.map((locale) =>
            (nodeLocales?.[locale]?.path ?? path).replace(":locale", locale)
          )
        : path
    )
    .filter((path) => !path.includes(":"));

  logger.info(`Writing to ${dir}...`);

  for (const path of pathsToRender) {
    logger.info("Rendering", path);

    const res = await request(
      origin.replace(".app", ".global"),
      `/api/v1/route?projectId=${projectId}&state=64&path=${encodeURIComponent(
        path
      )}`,
      apiKey,
      routeResponseSchema,
      { "x-uniform-deps": "true" }
    );

    if (res.type === "composition") {
      const fileName = `${dir}/${makeObjectKey(projectId, path)}`;
      const { dependencies, ...rest } = res;

      mkdirp.sync(nodePath.dirname(fileName));
      await fs.writeFile(fileName, JSON.stringify(rest), "utf8");
      logger.info(`Wrote ${fileName}`);
    }

    await updateTags({
      logger,
      dynamoClient,
      mappingTableName,
      projectId,
      path,
      dependencies: res.type === "composition" ? res.dependencies : undefined,
    });
  }

  const { sync } = new S3SyncClient({ client: new S3Client() });
  const monitor = new TransferMonitor();
  monitor.on("progress", (progress) => logger.info(progress));

  await sync(`${dir}/${projectId}`, `s3://${bucketName}/${projectId}`, {
    del: true,
    monitor,
    commandInput: () => ({ ContentType: "application/json" }),
  });

  await invalidate({ cloudfrontClient, distributionId, logger, items: ["/*"] });
}

async function renderAffected(dependencies: Dependencies, logger: Logger) {
  const {
    mappingTableName,
    projectId,
    apiKey,
    bucketName,
    distributionId,
    origin,
  } = prepareEnv();

  const tags = tagsFromDependencies(dependencies);

  logger.info("Affected tags", tags);

  const result = await Promise.all(
    tags.map((tag) =>
      dynamoClient.send(
        new QueryCommand({
          TableName: mappingTableName,
          ExpressionAttributeValues: {
            ":v1": { S: [projectId, tag].join("|") },
          },
          KeyConditionExpression: "tag = :v1",
          ProjectionExpression: "route",
        })
      )
    )
  );

  const pathsToRender = result.flatMap(({ Items }) =>
    (Items ?? [])
      .filter((i) => typeof i.route?.S === "string" && i.route.S.includes("|"))
      .map((i) => i.route.S!.split("|")[1])
  );

  logger.info("Affected paths", pathsToRender);

  const invalidations = new Set<string>();
  for (const path of pathsToRender) {
    logger.info("Rendering", path);

    const res = await request(
      origin.replace(".app", ".global"),
      `/api/v1/route?projectId=${projectId}&state=64&path=${encodeURIComponent(
        path
      )}`,
      apiKey,
      routeResponseSchema,
      { "x-uniform-deps": "true" }
    );

    const objectKey = makeObjectKey(projectId, path);
    invalidations.add(`/${objectKey}`);

    if (res.type !== "composition") {
      await s3client.send(
        new DeleteObjectCommand({
          Bucket: bucketName,
          Key: objectKey,
        })
      );

      logger.info("Deleted object", objectKey);
    } else {
      const { dependencies, ...rest } = res;

      await s3client.send(
        new PutObjectCommand({
          Bucket: bucketName,
          Key: objectKey,
          Body: JSON.stringify(rest),
          ContentType: "application/json",
        })
      );

      logger.info("Written object", objectKey);
    }

    await updateTags({
      logger,
      dynamoClient,
      mappingTableName,
      projectId,
      path,
      dependencies: res.type === "composition" ? res.dependencies : undefined,
    });
  }

  await invalidate({
    cloudfrontClient,
    distributionId,
    logger,
    items: Array.from(invalidations),
  });
}
