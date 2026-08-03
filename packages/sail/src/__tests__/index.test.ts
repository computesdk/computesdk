import { runProviderTestSuite } from '@computesdk/test-utils';
import { sail } from '../index';

runProviderTestSuite({
  name: 'sail',
  provider: sail({
    apiKey: process.env.SAIL_API_KEY,
    app: process.env.SAIL_APP,
  }),
  supportsFilesystem: true,
  // A routable URL requires a process to listen on the requested guest port.
  // Focused provider tests cover listener creation and protocol handling.
  supportsGetUrl: false,
  skipIntegration: !process.env.SAIL_API_KEY,
  filesystemBasePath: '/tmp',
  timeout: 120_000,
});
