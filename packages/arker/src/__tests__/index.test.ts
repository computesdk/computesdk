import { runProviderTestSuite } from '@computesdk/test-utils';
import { arker } from '../index';

const live = !!process.env.ARKER_API_KEY;

runProviderTestSuite({
  name: 'arker',
  provider: arker({}),
  supportsFilesystem: true,   // Arker VMs are full OS environments with persistent filesystems
  supportsGetUrl: true,      // ports are exposed via run-time tunnel requests, not a static URL
  supportsStreaming: true,    // served by the shell process tier over runCommand
  supportsProcesses: true,
  // The mock sandbox reports no runtime, so pin the tier only on live runs.
  expectProcessRuntime: live ? { streaming: 'shell', processes: 'shell' } : undefined,
  skipIntegration: !live,
});
