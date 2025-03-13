# static-route-api

## Commands

- `npm run clean` delete compiled JS
- `npm run build` compile TS to JS
- `npm run deploy` deploy the stack to your default AWS account and region
- `npm run all` all of above
- `npm run destroy` delete the stack; this also drops data (S3, Dynamo)

## Environment variables

- `UNIFORM_PROJECT_ID` project ID (required)
- `UNIFORM_API_KEY` API key (required)
- `UNIFORM_ORIGIN` Uniform API base URL (optional, default: `https://uniform.app`)
- `CRON_MINUTE` cron expression for minutes (optional, default: `0`)
- `CRON_HOUR` cron expression for hours (optional, default: `0,6,12,18`)

## Minimal deployment example

```
UNIFORM_PROJECT_ID=foo UNIFORM_API_KEY=bar npm run all
```

This also requires AWS credentials to be configured.

## Incremental updates (surgical invalidation)

Instead (or in addition) to scheduled updates we may invalidate only affected routes as they change:

1. Grab the `LambdaUrl` output of the deployed stack (will look like this: `https://(uuid).lambda-url.(region).on.aws/`)
2. Get your project entity: `GET ${UNIFORM_ORIGIN}/api/v1/project?projectId=(uuid)`
3. Update your project by `PUT`ting in the URL above adding `{ ..., "dependencyInvalidationHookUrl": "https://(uuid).lambda-url.(region).on.aws/" }` to the body
