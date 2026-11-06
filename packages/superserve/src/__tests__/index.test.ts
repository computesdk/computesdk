import { runProviderTestSuite } from '@computesdk/test-utils';
import { superserve } from '../index';

runProviderTestSuite({
  name: 'superserve',
  provider: superserve({}),
  supportsFilesystem: true,
  supportsStreaming: true,
  supportsProcesses: true,
  supportsPauseResume: true,
  supportsSnapshots: true,
  skipIntegration: !process.env.SUPERSERVE_API_KEY,
});
