import { runProviderTestSuite } from '@computesdk/test-utils';
import { blaxel } from '../index';

const hasCredentials = Boolean(process.env.BL_API_KEY && process.env.BL_WORKSPACE);

runProviderTestSuite({
  name: 'blaxel',
  provider: blaxel({}),
  supportsFilesystem: true,   // Blaxel supports filesystem operations via fs API
  supportsStreaming: true,
  supportsProcesses: true,
  supportsSnapshots: true,
  // Streaming is served by Blaxel's process API; background processes use the shell tier.
  ...(hasCredentials && { expectProcessRuntime: { streaming: 'native' as const, processes: 'shell' as const } }),
  skipIntegration: !hasCredentials
});
