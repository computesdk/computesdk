import { runBrowserProviderTestSuite } from '@computesdk/test-utils';
import { browserless } from '../index';

runBrowserProviderTestSuite({
  name: 'browserless',
  provider: browserless({}),
  skipIntegration: !process.env.BROWSERLESS_API_KEY,
  // create() only mints a trackingId — nothing exists server-side to read
  // back until a client opens the connect websocket (and /sessions is
  // private-fleet only), so getById/list assertions can't run.
  skipSessionReads: true,
});
