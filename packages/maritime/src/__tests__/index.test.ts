import { runProviderTestSuite } from '@computesdk/test-utils';
import { maritime } from '../index';

runProviderTestSuite({
  name: 'maritime',
  provider: maritime({}),
  supportsFilesystem: true,
  supportsStreaming: true,
  supportsGetUrl: true,
  supportsPauseResume: true,
  skipIntegration: !process.env.MARITIME_API_KEY,
});
