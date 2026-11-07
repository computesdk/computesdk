import { runProviderTestSuite } from '@computesdk/test-utils';
import { tangle } from '../index';

runProviderTestSuite({
  name: 'tangle',
  provider: tangle({}),
  supportsFilesystem: true,
  // Live output and interactive processes are not qualified for this package yet.
  supportsStreaming: false,
  supportsProcesses: false,
  skipIntegration: !process.env.TANGLE_API_KEY,
});
