import { runProviderTestSuite } from '@computesdk/test-utils';
import { vercel } from '../index';

runProviderTestSuite({
  name: 'vercel',
  provider: vercel({}),
  supportsFilesystem: false,   // Vercel sandboxes don't support filesystem operations
  skipIntegration: !process.env.VERCEL_TOKEN || !process.env.VERCEL_TEAM_ID || !process.env.VERCEL_PROJECT_ID,
  // Note: Vercel blocks certain ports (80, 443, 8080). Use allowed ports for getUrl tests.
  ports: [3000, 8000],
});