import { runProviderTestSuite } from '@computesdk/test-utils';
import { luxor } from '../index';

runProviderTestSuite({
  name: 'tenki',
  provider: luxor({
    apiKey: process.env.LUXORAI_API_KEY ?? process.env.TENKI_API_KEY,
    workspaceId: process.env.LUXORAI_WORKSPACE_ID ?? process.env.TENKI_WORKSPACE_ID,
  }),
  supportsFilesystem: true,
  supportsGetUrl: true,
  // Luxor serves onStdout/onStderr by tailing the command's output itself.
  supportsStreaming: true,
  supportsPauseResume: true,
  supportsSnapshots: true,
  skipIntegration: !process.env.LUXORAI_API_KEY && !process.env.TENKI_API_KEY,
  // Luxor's data-plane filesystem API operates under the sandbox user's home.
  filesystemBasePath: '/home/tenki',
});
