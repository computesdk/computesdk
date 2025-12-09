import { runProviderTestSuite } from '@computesdk/test-utils';
import { awsLambda } from '../index';

runProviderTestSuite({
  name: 'aws-lambda',
  provider: awsLambda({
    roleArn: process.env.AWS_LAMBDA_ROLE_ARN || 'arn:aws:iam::123456789012:role/lambda-execution-role',
    region: process.env.AWS_REGION,
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  }),
  supportsFilesystem: false,
  skipIntegration: !process.env.AWS_LAMBDA_ROLE_ARN || !process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY
});
