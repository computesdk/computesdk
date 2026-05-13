import { runBrowserProviderTestSuite } from '@computesdk/test-utils';
import { anchorbrowser } from '../index';

runBrowserProviderTestSuite({
  name: 'anchorbrowser',
  provider: anchorbrowser({}),
  skipIntegration: !process.env.ANCHORBROWSER_API_KEY,
});
