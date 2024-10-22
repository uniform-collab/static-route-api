type OverridenResponse = AWSCloudFrontFunction.Response & { body: string };

function respond(statusCode: number, body: unknown): OverridenResponse {
  return {
    statusCode,
    body: JSON.stringify(body),
    headers: { "content-type": { value: "application/json" } },
  };
}

async function handler(
  event: AWSCloudFrontFunction.Event
): Promise<AWSCloudFrontFunction.Request | OverridenResponse> {
  const request = event.request;

  const isRouteApiRequest =
    request.uri === "/api/v1/route" || request.uri.startsWith("/api/v1/route?");

  if (!isRouteApiRequest) {
    return respond(501, { message: "Not Implemented" });
  }

  const qs = request.querystring;

  for (const key of ["projectId", "path", "state"]) {
    if (!qs[key] || typeof qs[key].value !== "string") {
      return respond(422, { message: `${key} is required` });
    }
  }

  if (!qs.state || qs.state.value !== "64") {
    return respond(422, { message: "state must be 64" });
  }

  for (const key of [
    "projectMapId",
    "withComponentIDs",
    "withContentSourceMap",
    "releaseId",
    "dataResourcesVariant",
  ]) {
    if (qs[key] && typeof qs[key].value === "string") {
      return respond(422, { message: `${key} is not allowed` });
    }
  }

  const pathBase64 = Buffer.from(qs.path.value).toString("base64url");

  request.uri = `/${qs.projectId.value}/${pathBase64}/64.json`;

  return request;
}
