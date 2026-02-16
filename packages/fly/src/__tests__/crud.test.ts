import { runProviderCrudTest } from '@computesdk/test-utils';
import { fly } from '../index';

runProviderCrudTest({
  name: 'fly',
  provider: fly({
    // Uses FLY_API_TOKEN from env
    // Default appName: 'compute-sdk'
  }),
  skipIntegration: !process.env.FLY_API_TOKEN
});