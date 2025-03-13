import {
  CloudFrontClient,
  CreateInvalidationCommand,
} from "@aws-sdk/client-cloudfront";
import { Logger } from "./logger";

export async function invalidate({
  distributionId,
  cloudfrontClient,
  logger,
  items,
}: {
  cloudfrontClient: CloudFrontClient;
  logger: Logger;
  distributionId: string;
  items: string[];
}) {
  logger.info("Invalidate distribution", distributionId, items);

  await cloudfrontClient.send(
    new CreateInvalidationCommand({
      DistributionId: distributionId,
      InvalidationBatch: {
        CallerReference: Date.now().toString(),
        Paths: {
          Quantity: items.length,
          Items: items,
        },
      },
    })
  );
}
