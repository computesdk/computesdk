import { runProviderTestSuite } from '@computesdk/test-utils';
import { vercel } from '../index';

runProviderTestSuite({
  name: 'vercel',
  provider: vercel({}),
  supportsFilesystem: false,   // Vercel sandboxes don't support filesystem operations
  skipIntegration: !process.env.VERCEL_TOKEN || !process.env.VERCEL_TEAM_ID || !process.env.VERCEL_PROJECT_ID,
  ports: [3000, 8080]  // Enable getUrl tests - passed to create() options
});