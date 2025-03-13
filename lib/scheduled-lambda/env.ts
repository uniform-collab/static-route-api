export function prepareEnv() {
  if (
    !process.env.MAPPING_TABLE_NAME ||
    !process.env.BUCKET_NAME ||
    !process.env.DISTRIBUTION_ID ||
    !process.env.UNIFORM_PROJECT_ID ||
    !process.env.UNIFORM_API_KEY
  ) {
    throw new Error(
      "Missing one or more of MAPPING_TABLE_NAME, BUCKET_NAME, DISTRIBUTION_ID, UNIFORM_PROJECT_ID, UNIFORM_API_KEY"
    );
  }

  const mappingTableName = process.env.MAPPING_TABLE_NAME;
  const bucketName = process.env.BUCKET_NAME;
  const distributionId = process.env.DISTRIBUTION_ID;
  const origin = process.env.UNIFORM_ORIGIN || "https://uniform.app";
  const projectId = process.env.UNIFORM_PROJECT_ID;
  const apiKey = process.env.UNIFORM_API_KEY;

  return {
    mappingTableName,
    bucketName,
    distributionId,
    origin,
    projectId,
    apiKey,
  };
}
