import { runBrowserProviderTestSuite } from '@computesdk/test-utils';
import { steel } from '../index';

runBrowserProviderTestSuite({
  name: 'steel',
  provider: steel({}),
  skipIntegration: !process.env.STEEL_API_KEY,
});
