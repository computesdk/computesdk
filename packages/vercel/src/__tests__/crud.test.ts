import { runProviderCrudTest } from '@computesdk/test-utils';
import { vercel } from '../index';

runProviderCrudTest({
  name: 'vercel',
  provider: vercel({}), // Uses VERCEL_TOKEN, VERCEL_TEAM_ID, and VERCEL_PROJECT_ID from env
  skipIntegration: !process.env.VERCEL_TOKEN || !process.env.VERCEL_TEAM_ID || !process.env.VERCEL_PROJECT_ID
});