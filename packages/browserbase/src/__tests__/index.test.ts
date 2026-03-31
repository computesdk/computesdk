import { runBrowserProviderTestSuite } from '@computesdk/test-utils';
import { browserbase } from '../index';

runBrowserProviderTestSuite({
  name: 'browserbase',
  provider: browserbase({}),
  skipIntegration: !process.env.BROWSERBASE_API_KEY,
});
