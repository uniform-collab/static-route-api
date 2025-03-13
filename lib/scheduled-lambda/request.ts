import { ZodSchema } from "zod/lib/external";

export async function request<TExpectedType>(
  origin: string,
  uri: string,
  apiKey: string,
  schema: ZodSchema<TExpectedType>,
  extraHeaders: Record<string, string> = {}
): Promise<TExpectedType> {
  const res = await fetch(`${origin}${uri}`, {
    headers: {
      "x-api-key": apiKey,
      "x-bypass-cache": "true",
      ...extraHeaders,
    },
  });

  return schema.parseAsync(await res.json());
}
