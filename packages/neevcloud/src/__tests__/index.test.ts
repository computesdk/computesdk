import { runProviderTestSuite } from '@computesdk/test-utils';
import { neevcloud } from '../index';

runProviderTestSuite({
  name: 'neevcloud',
  provider: neevcloud({}),
  supportsFilesystem: true, // NeevCloud supports filesystem operations
  supportsStreaming: true, // onStdout/onStderr stream over the exec API, no daemon port needed
  skipIntegration: !process.env.NEEV_API_KEY,
  ports: [3000, 8080], // Enable getUrl tests
});
