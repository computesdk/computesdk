import { runBrowserProviderTestSuite } from '@computesdk/test-utils';
import { styneBrowser } from '../index';

runBrowserProviderTestSuite({
  name: 'styne-browser',
  provider: styneBrowser({}),
  skipIntegration: !process.env.STYNE_API_KEY,
});
