import { runProviderTestSuite } from '@computesdk/test-utils';
import { vercel } from '../index';

const skipIntegration = !process.env.VERCEL_TOKEN || !process.env.VERCEL_TEAM_ID || !process.env.VERCEL_PROJECT_ID;

runProviderTestSuite({
  name: 'vercel',
  provider: vercel({}),
  supportsFilesystem: true,
  // No native streaming/process API in the adapter: both run on the shell process tier.
  supportsStreaming: true,
  supportsProcesses: true,
  // The mock sandbox reports no process runtime, so only assert it live.
  expectProcessRuntime: skipIntegration ? undefined : { streaming: 'shell', processes: 'shell' },
  skipIntegration,
  // Note: Vercel blocks certain ports (80, 443, 8080). Use allowed ports for getUrl tests.
  ports: [3000, 8000],
});
