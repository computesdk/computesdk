import { runProviderTestSuite } from '@computesdk/test-utils';
import { daytona } from '../index';

const live = !!process.env.DAYTONA_API_KEY;

runProviderTestSuite({
  name: 'daytona',
  provider: daytona({}),
  supportsFilesystem: true,
  // Streaming and processes ride the framework's shell tier over executeCommand.
  supportsStreaming: true,
  supportsProcesses: true,
  expectProcessRuntime: live ? { streaming: 'shell', processes: 'shell' } : undefined,
  skipIntegration: !live,
  timeout: 120000,
  ports: [3000, 8080],
});
