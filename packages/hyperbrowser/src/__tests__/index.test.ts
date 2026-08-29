import { runBrowserProviderTestSuite } from '@computesdk/test-utils';
import { hyperbrowser } from '../index';

runBrowserProviderTestSuite({
  name: 'hyperbrowser',
  provider: hyperbrowser({}),
  skipIntegration: !process.env.HYPERBROWSER_API_KEY,
});
