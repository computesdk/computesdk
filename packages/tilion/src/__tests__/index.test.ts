import { runBrowserProviderTestSuite } from '@computesdk/test-utils';
import { tilion } from '../index';

runBrowserProviderTestSuite({
  name: 'tilion',
  provider: tilion({}),
  skipIntegration: !process.env.TILION_API_KEY,
});
