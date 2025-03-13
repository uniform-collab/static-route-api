import { z } from "zod";

export const projectMapsResponseSchema = z.object({
  projectMaps: z.array(
    z.object({ id: z.string(), default: z.boolean().optional() })
  ),
});

export const projectMapNodesResponseSchema = z.object({
  nodes: z.array(
    z.object({
      id: z.string(),
      path: z.string(),
      locales: z
        .record(z.string(), z.object({ path: z.string().optional() }))
        .optional(),
    })
  ),
});

export const localesResponseSchema = z.object({
  results: z.array(z.object({ locale: z.string() })),
});

export const dependenciesSchema = z.record(
  z.string(),
  z.union([z.array(z.string()), z.array(z.object({}).passthrough())])
);

export type Dependencies = z.infer<typeof dependenciesSchema>;

export const routeResponseSchema = z.union([
  z.object({ type: z.literal("notFound") }),
  z.object({
    type: z.literal("composition"),
    matchedRoute: z.string(),
    dynamicInputs: z.record(z.string(), z.string()),
    compositionApiResponse: z.unknown(),
    dependencies: dependenciesSchema,
  }),
  z.object({ type: z.literal("redirect") }),
]);
