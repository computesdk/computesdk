import { runProviderTestSuite } from '@computesdk/test-utils';
import { sandock } from '../index';

runProviderTestSuite({
  name: 'sandock',
  provider: sandock({}), // SANDOCK_API_KEY (and optional SANDOCK_BASE_URL / SANDOCK_SPACE_ID) from the environment
  supportsFilesystem: true,
  supportsGetUrl: true, // signed preview URLs
  supportsStreaming: true, // onStdout / onStderr are served by Sandock's SSE shell stream
  supportsProcesses: true, // startProcess runs through daemond; the default image ships Node.js
  skipIntegration: !process.env.SANDOCK_API_KEY,
  timeout: 90_000,
});
