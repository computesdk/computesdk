import { runProviderTestSuite } from '@computesdk/test-utils';
import { kosa8 } from '../index';

runProviderTestSuite({
  name: 'kosa8',
  provider: kosa8({}),
  supportsFilesystem: true,
  supportsGetUrl: false,
  skipIntegration: !process.env.KOSA8_API_KEY,
});
