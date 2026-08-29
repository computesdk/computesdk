import { runProviderTestSuite } from '@computesdk/test-utils';
import { railway } from '../index';

runProviderTestSuite({
  name: 'railway',
  provider: railway({}),
  supportsFilesystem: true, // implemented over the shell via exec
  supportsGetUrl: false, // Railway sandboxes do not expose public per-port URLs
  skipIntegration: !process.env.RAILWAY_API_TOKEN,
});
