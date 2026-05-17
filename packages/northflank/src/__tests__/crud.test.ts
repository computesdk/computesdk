import { runProviderCrudTest } from '@computesdk/test-utils';
import { northflank } from '../index';

runProviderCrudTest({
  name: 'northflank',
  provider: northflank({
    token: process.env.NORTHFLANK_TOKEN!,
    projectId: process.env.NORTHFLANK_PROJECT_ID!,
    ...(process.env.NORTHFLANK_API_URL ? { host: process.env.NORTHFLANK_API_URL } : {}),
  }),
  timeout: 120_000,
  skipIntegration: !process.env.NORTHFLANK_TOKEN || !process.env.NORTHFLANK_PROJECT_ID,
});
