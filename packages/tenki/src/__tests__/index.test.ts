import { runProviderTestSuite } from '@computesdk/test-utils';
import { luxor } from '../index';

runProviderTestSuite({
  name: 'tenki',
  provider: luxor({
    apiKey: process.env.LUXOR_API_KEY ?? process.env.LUXOR_AUTH_TOKEN ?? process.env.LUXORAI_API_KEY ?? process.env.LUXORAI_AUTH_TOKEN ?? process.env.TENKI_API_KEY ?? process.env.TENKI_AUTH_TOKEN,
    workspaceId: process.env.LUXOR_WORKSPACE_ID ?? process.env.LUXORAI_WORKSPACE_ID ?? process.env.TENKI_WORKSPACE_ID,
  }),
  supportsFilesystem: true,
  supportsGetUrl: true,
  // Luxor serves onStdout/onStderr by tailing the command's output itself.
  supportsStreaming: true,
  supportsPauseResume: true,
  supportsSnapshots: true,
  skipIntegration: !['LUXOR_API_KEY','LUXOR_AUTH_TOKEN','LUXORAI_API_KEY','LUXORAI_AUTH_TOKEN','TENKI_API_KEY','TENKI_AUTH_TOKEN'].some((name) => process.env[name]),
  // Luxor's data-plane filesystem API operates under the sandbox user's home.
  filesystemBasePath: '/home/tenki',
});
