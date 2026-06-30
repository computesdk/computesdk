import { runProviderTestSuite } from '@computesdk/test-utils';
import { tenki } from '../index';

runProviderTestSuite({
  name: 'tenki',
  provider: tenki({
    apiKey: process.env.TENKI_API_KEY,
    workspaceId: process.env.TENKI_WORKSPACE_ID,
    projectId: process.env.TENKI_PROJECT_ID,
  }),
  supportsFilesystem: true,
  supportsGetUrl: true,
  skipIntegration: !process.env.TENKI_API_KEY,
  // Tenki's data-plane filesystem API operates under the sandbox user's home.
  filesystemBasePath: '/home/tenki',
});
