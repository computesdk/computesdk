import { runProviderTestSuite } from '@computesdk/test-utils';
import { coreweave } from '../index';

runProviderTestSuite({
  name: 'coreweave',
  provider: coreweave({}),
  supportsFilesystem: true,
  // Live output and interactive processes are not qualified for this package yet.
  supportsStreaming: false,
  supportsProcesses: false,
  ports: [3000],
  skipIntegration: !process.env.CWSANDBOX_API_KEY,
});
