import { runProviderTestSuite } from '@computesdk/test-utils';
import { vercel } from '../index';

runProviderTestSuite({
  name: 'Vercel',
  provider: vercel({}),
  supportsFilesystem: true,  // Vercel supports filesystem operations
  supportsTerminal: false,   // Vercel doesn't support terminal operations
  supportsPython: true,      // Vercel supports Python runtime
  skipIntegration: !process.env.VERCEL_TOKEN || !process.env.VERCEL_TEAM_ID || !process.env.VERCEL_PROJECT_ID
});