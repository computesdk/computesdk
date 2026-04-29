import { runBrowserProviderTestSuite } from '@computesdk/test-utils';
import { browseruse } from '../index';

runBrowserProviderTestSuite({
  name: 'browseruse',
  provider: browseruse({}),
  skipIntegration: !process.env.BROWSER_USE_API_KEY,
});
