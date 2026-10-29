import { runBrowserProviderTestSuite } from '@computesdk/test-utils';
import { browserless } from '../index';

runBrowserProviderTestSuite({
  name: 'browserless',
  provider: browserless({}),
  skipIntegration: !process.env.BROWSERLESS_API_KEY,
});
