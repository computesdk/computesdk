import { runProviderTestSuite } from '@computesdk/test-utils';
import { lightning } from '../index';

runProviderTestSuite({
  name: 'lightning',
  provider: lightning({}),
  supportsFilesystem: true,
  // The Lightning SDK has no public port-URL API, so getUrl throws by design.
  supportsGetUrl: false,
  skipIntegration: !process.env.LIGHTNING_API_KEY,
});
