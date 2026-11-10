import { runProviderTestSuite } from '@computesdk/test-utils';
import { sandboxCli } from '../index';

runProviderTestSuite({
  name: 'sandbox-cli',
  provider: sandboxCli({}),
  supportsFilesystem: true,
  // Ports are reached through the API's tunnel, not a URL.
  supportsGetUrl: false,
  // Live output comes from the API's own process stream (streamCommand).
  supportsStreaming: true,
  skipIntegration: !process.env.SANDBOX_ENDPOINT || !process.env.SANDBOX_TOKEN,
});
