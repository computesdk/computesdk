import { runProviderCrudTest } from '@computesdk/test-utils';
import { lambda } from '../index';

runProviderCrudTest({
  name: 'lambda',
  provider: lambda({}), // Uses LAMBDA_API_KEY, LAMBDA_REGION_NAME, LAMBDA_INSTANCE_TYPE_NAME, and LAMBDA_SSH_KEY_NAME from env
  skipIntegration: !process.env.LAMBDA_API_KEY || !process.env.LAMBDA_REGION_NAME || !process.env.LAMBDA_INSTANCE_TYPE_NAME || !process.env.LAMBDA_SSH_KEY_NAME
});