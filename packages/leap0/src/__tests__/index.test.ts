import { runProviderTestSuite } from '@computesdk/test-utils';
import { leap0 } from '../index';

runProviderTestSuite({
  name: 'leap0',
  provider: leap0({}),
  supportsFilesystem: true,
  skipIntegration: !process.env.LEAP0_API_KEY,
});
