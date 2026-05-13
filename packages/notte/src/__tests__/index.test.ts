import { runBrowserProviderTestSuite } from '@computesdk/test-utils';
import { notte } from '../index';

runBrowserProviderTestSuite({
  name: 'notte',
  provider: notte({}),
  skipIntegration: !process.env.NOTTE_API_KEY,
});
