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

    // Lambda
    const scheduledLambda = new lambda.Function(this, "ScheduledLambda", {
      runtime: lambda.Runtime.NODEJS_20_X,
      code: lambda.Code.fromAsset("lib/scheduled-lambda"),
      handler: "index.handler",
      memorySize: 1024,
      timeout: Duration.seconds(60),
      environment: {
        BUCKET_NAME: bucket.bucketName,
        DISTRIBUTION_ID: distribution.distributionId,
        UNIFORM_ORIGIN: process.env.UNIFORM_ORIGIN || "",
        UNIFORM_PROJECT_ID: process.env.UNIFORM_PROJECT_ID || "",
        UNIFORM_API_KEY: process.env.UNIFORM_API_KEY || "",
      },
    });

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
