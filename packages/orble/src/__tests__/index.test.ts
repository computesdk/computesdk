import { runProviderTestSuite } from '@computesdk/test-utils';
import { orble } from '../index';

runProviderTestSuite({
  name: 'orble',
  provider: orble({}),
  supportsFilesystem: true,
  supportsStreaming: false,
  supportsProcesses: true,
  skipIntegration: !process.env.ORBLE_API_KEY,
});
