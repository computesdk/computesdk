import { runProviderTestSuite } from '@computesdk/test-utils';
import { vercel } from '../index';

const skipIntegration = !process.env.VERCEL_TOKEN || !process.env.VERCEL_TEAM_ID || !process.env.VERCEL_PROJECT_ID;

runProviderTestSuite({
  name: 'vercel',
  provider: vercel({}),
  supportsFilesystem: true,
  // Streaming uses Vercel's native log stream; processes run on the shell process tier.
  supportsStreaming: true,
  supportsProcesses: true,
  // The mock sandbox reports no process runtime, so only assert it live.
  expectProcessRuntime: skipIntegration ? undefined : { streaming: 'native', processes: 'shell' },
  skipIntegration,
  // Pause is a stop of a persistent sandbox; snapshots keep the whole rootfs.
  supportsPauseResume: true,
  supportsSnapshots: true,
  // Note: Vercel blocks certain ports (80, 443, 8080). Use allowed ports for getUrl tests.
  ports: [3000, 8000],
});
