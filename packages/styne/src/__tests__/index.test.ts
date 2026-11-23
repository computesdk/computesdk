import { runProviderTestSuite } from '@computesdk/test-utils';
import { styne } from '../index';

runProviderTestSuite({
  name: 'styne',
  provider: styne({}),
  supportsFilesystem: true,
  supportsStreaming: true,
  skipIntegration: !process.env.STYNE_API_KEY,
});
