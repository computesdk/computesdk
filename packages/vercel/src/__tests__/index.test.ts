import { runProviderTestSuite } from '@computesdk/test-utils';
import { vercel } from '../index';

runProviderTestSuite({
  name: 'vercel',
  provider: vercel({}),
  supportsFilesystem: true,   // Vercel filesystem operations now use proper stdout()/stderr() methods
  supportsPython: true,       // Vercel supports Python runtime
  skipIntegration: !process.env.VERCEL_TOKEN || !process.env.VERCEL_TEAM_ID || !process.env.VERCEL_PROJECT_ID
});