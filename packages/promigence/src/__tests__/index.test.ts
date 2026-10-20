import { runProviderTestSuite } from '@computesdk/test-utils';
import { promigence } from '../index';

runProviderTestSuite({
  name: 'promigence',
  provider: promigence({}), // PROMIGENCE_API_KEY (and PROMIGENCE_SPEND_CAP) from the environment
  supportsFilesystem: true,
  supportsGetUrl: false, // preview URLs are not offered yet: getUrl() throws
  supportsStreaming: true, // onStdout / onStderr are served by the provider itself
  skipIntegration: !process.env.PROMIGENCE_API_KEY,
});
