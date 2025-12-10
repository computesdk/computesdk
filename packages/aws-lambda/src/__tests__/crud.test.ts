import { runProviderCrudTest } from '@computesdk/test-utils';
import { awsLambda } from '../index';

runProviderCrudTest({
  name: 'aws-lambda',
  provider: awsLambda({
    roleArn: process.env.AWS_LAMBDA_ROLE_ARN,
    region: process.env.AWS_REGION,
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  }),
  skipIntegration: !process.env.AWS_LAMBDA_ROLE_ARN || !process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY
});
