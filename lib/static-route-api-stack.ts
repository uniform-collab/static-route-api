import {
  Stack,
  StackProps,
  CfnOutput,
  Duration,
  aws_s3 as s3,
  aws_cloudfront as cloudfront,
  aws_cloudfront_origins as origins,
  aws_lambda as lambda,
  aws_events as events,
  aws_events_targets as targets,
  aws_iam as iam,
  aws_dynamodb as ddb,
  RemovalPolicy,
} from "aws-cdk-lib";
import { Construct } from "constructs";

export class StaticRouteApiStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    // S3
    const corsRule: s3.CorsRule = {
      allowedMethods: [s3.HttpMethods.GET, s3.HttpMethods.HEAD],
      allowedOrigins: ["*"],
      allowedHeaders: ["*"],
      maxAge: 300,
    };

    const bucket = new s3.Bucket(this, "Bucket", {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      accessControl: s3.BucketAccessControl.PRIVATE,
      cors: [corsRule],
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    new CfnOutput(this, "BucketName", { value: bucket.bucketName });
    new CfnOutput(this, "BucketDomainName", { value: bucket.bucketDomainName });

    // OAI
    const oai = new cloudfront.OriginAccessIdentity(this, "OAI");
    bucket.grantRead(oai);

    // CloudFront
    const distribution = new cloudfront.Distribution(this, "Distribution", {
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessIdentity(bucket, {
          originAccessIdentity: oai,
        }),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD,
        functionAssociations: [
          {
            eventType: cloudfront.FunctionEventType.VIEWER_REQUEST,
            function: new cloudfront.Function(this, "ViewerRequestFunction", {
              runtime: cloudfront.FunctionRuntime.JS_2_0,
              code: cloudfront.FunctionCode.fromFile({
                filePath: "lib/viewer-request.js",
              }),
            }),
          },
        ],
      },
    });

    new CfnOutput(this, "DistributionId", {
      value: distribution.distributionId,
    });
    new CfnOutput(this, "DistributionDomainName", {
      value: distribution.distributionDomainName,
    });

    // DynamoDB
    const mappingTable = new ddb.Table(this, "MappingTable", {
      partitionKey: { name: "tag", type: ddb.AttributeType.STRING },
      sortKey: { name: "route", type: ddb.AttributeType.STRING },
      billingMode: ddb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    mappingTable.addGlobalSecondaryIndex({
      indexName: "byRoute",
      partitionKey: { name: "route", type: ddb.AttributeType.STRING },
    });

    new CfnOutput(this, "MappingTableName", {
      value: mappingTable.tableName,
    });

    // Lambda
    const scheduledLambda = new lambda.Function(this, "ScheduledLambda", {
      runtime: lambda.Runtime.NODEJS_20_X,
      code: lambda.Code.fromAsset("lib/scheduled-lambda"),
      handler: "index.handler",
      memorySize: 1024,
      timeout: Duration.seconds(5 * 60),
      environment: {
        MAPPING_TABLE_NAME: mappingTable.tableName,
        BUCKET_NAME: bucket.bucketName,
        DISTRIBUTION_ID: distribution.distributionId,
        UNIFORM_ORIGIN: process.env.UNIFORM_ORIGIN || "",
        UNIFORM_PROJECT_ID: process.env.UNIFORM_PROJECT_ID || "",
        UNIFORM_API_KEY: process.env.UNIFORM_API_KEY || "",
      },
    });

    const lambdaUrl = scheduledLambda.addFunctionUrl({
      authType: lambda.FunctionUrlAuthType.NONE,
    });

    new CfnOutput(this, "LambdaUrl", { value: lambdaUrl.url });

    scheduledLambda.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"],
        effect: iam.Effect.ALLOW,
        resources: [`arn:aws:s3:::${bucket.bucketName}/*`],
      })
    );

    scheduledLambda.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["s3:ListBucket"],
        effect: iam.Effect.ALLOW,
        resources: [`arn:aws:s3:::${bucket.bucketName}`],
      })
    );

    scheduledLambda.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["cloudfront:CreateInvalidation"],
        effect: iam.Effect.ALLOW,
        resources: [
          `arn:aws:cloudfront::${this.account}:distribution/${distribution.distributionId}`,
        ],
      })
    );

    scheduledLambda.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["dynamodb:Query", "dynamodb:BatchWriteItem"],
        effect: iam.Effect.ALLOW,
        resources: [
          `arn:aws:dynamodb:${this.region}:${this.account}:table/${mappingTable.tableName}`,
          `arn:aws:dynamodb:${this.region}:${this.account}:table/${mappingTable.tableName}/index/byRoute`,
        ],
      })
    );

    const scheduleRule = new events.Rule(this, "ScheduleRule", {
      schedule: events.Schedule.cron({
        minute: process.env.CRON_MINUTE || "0",
        hour: process.env.CRON_HOUR || "0,6,12,18",
      }),
    });
    scheduleRule.addTarget(new targets.LambdaFunction(scheduledLambda));

    new CfnOutput(this, "ScheduledLambdaName", {
      value: scheduledLambda.functionName,
    });
  }
}
