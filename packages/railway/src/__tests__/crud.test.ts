import { runProviderCrudTest } from '@computesdk/test-utils';
import { railway } from '../index';

runProviderCrudTest({
  name: 'railway',
  provider: railway({}), // Uses RAILWAY_API_KEY, RAILWAY_PROJECT_ID, and RAILWAY_ENVIRONMENT_ID from env
  skipIntegration: !process.env.RAILWAY_API_KEY || !process.env.RAILWAY_PROJECT_ID || !process.env.RAILWAY_ENVIRONMENT_ID
});