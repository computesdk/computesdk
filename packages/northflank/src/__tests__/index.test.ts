import { runProviderTestSuite } from '@computesdk/test-utils';
import { northflank } from '../index';

runProviderTestSuite({
  name: 'northflank',
  provider: northflank({
    token: process.env.NORTHFLANK_TOKEN!,
    projectId: process.env.NORTHFLANK_PROJECT_ID!,
    ...(process.env.NORTHFLANK_API_URL ? { host: process.env.NORTHFLANK_API_URL } : {}),
  }),
  supportsFilesystem: true,
  skipIntegration: !process.env.NORTHFLANK_TOKEN || !process.env.NORTHFLANK_PROJECT_ID,
  ports: [3000],
});
