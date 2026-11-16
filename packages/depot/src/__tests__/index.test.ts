import { runProviderTestSuite } from '@computesdk/test-utils';
import { depot } from '../index';

runProviderTestSuite({
  name: 'depot',
  provider: depot({}),
  supportsFilesystem: true,
  supportsGetUrl: false,
  // Live output and interactive processes are not qualified for this package yet.
  supportsStreaming: false,
  supportsProcesses: false,
  skipIntegration: !process.env.DEPOT_TOKEN,
});
