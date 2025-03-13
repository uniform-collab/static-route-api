import {
  BatchWriteItemCommand,
  DynamoDBClient,
  QueryCommand,
  WriteRequest,
} from "@aws-sdk/client-dynamodb";
import { Logger } from "./logger";
import { Dependencies } from "./typesAndSchemas";
import stableStringify from "json-stable-stringify";

export function tagsFromDependencies(dependencies?: Dependencies) {
  return Object.entries(dependencies ?? {}).flatMap(([key, val]) =>
    val.map((v) =>
      [key, typeof v === "string" ? v : stableStringify(v)].join("!")
    )
  );
}

export async function updateTags({
  logger,
  dynamoClient,
  mappingTableName,
  projectId,
  path,
  dependencies,
}: {
  logger: Logger;
  dynamoClient: DynamoDBClient;
  mappingTableName: string;
  projectId: string;
  path: string;
  dependencies: Dependencies | undefined;
}) {
  logger.info("Updating tags");

  const tagsToDeleteResult = await dynamoClient.send(
    new QueryCommand({
      TableName: mappingTableName,
      IndexName: "byRoute",
      ExpressionAttributeValues: {
        ":v1": { S: [projectId, path].join("|") },
      },
      KeyConditionExpression: "route = :v1",
      ProjectionExpression: "tag",
    })
  );

  const tagsToDelete = (tagsToDeleteResult.Items ?? [])
    .filter((i) => typeof i.tag?.S === "string" && i.tag.S.includes("|"))
    .map((i) => i.tag.S!.split("|")[1]);

  logger.info("Tags to delete", tagsToDelete);

  if (tagsToDelete.length > 0) {
    for (let i = 0; i < tagsToDelete.length; i += 25) {
      const chunk = tagsToDelete.slice(i, i + 25);

      await dynamoClient.send(
        new BatchWriteItemCommand({
          RequestItems: {
            [mappingTableName]: chunk.reduce(
              (acc, tag) => [
                ...acc,
                {
                  DeleteRequest: {
                    Key: {
                      tag: { S: [projectId, tag].join("|") },
                      route: { S: [projectId, path].join("|") },
                    },
                  },
                },
              ],
              [] as WriteRequest[]
            ),
          },
        })
      );
    }
  }

  const tagsToAdd = tagsFromDependencies(dependencies);

  logger.info("Tags to add", tagsToAdd);

  if (tagsToAdd.length > 0) {
    for (let i = 0; i < tagsToAdd.length; i += 25) {
      const chunk = tagsToAdd.slice(i, i + 25);

      await dynamoClient.send(
        new BatchWriteItemCommand({
          RequestItems: {
            [mappingTableName]: chunk.reduce(
              (acc, tag) => [
                ...acc,
                {
                  PutRequest: {
                    Item: {
                      tag: { S: [projectId, tag].join("|") },
                      route: { S: [projectId, path].join("|") },
                    },
                  },
                },
              ],
              [] as WriteRequest[]
            ),
          },
        })
      );
    }
  }
}
