import { runBrowserProviderTestSuite } from '@computesdk/test-utils';
import { outcrawl } from '../index';

runBrowserProviderTestSuite({
  name: 'outcrawl',
  provider: outcrawl({}),
  skipIntegration: !process.env.OUTCRAWL_API_KEY,
  // create() only allocates a connect ticket: a session has no record on Outcrawl
  // until a client opens the CDP websocket, so getById/list cannot see it yet.
  skipSessionReads: true,
});
