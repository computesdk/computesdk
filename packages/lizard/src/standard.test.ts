import { runProviderTestSuite } from '@computesdk/test-utils';
import { lizard } from './index';

// The shared suite's offline mode uses a generic mock. See index.test.ts for
// tests that exercise this provider itself without credentials.
runProviderTestSuite({
  provider: lizard({ size: 'small', timeout: 300000 }),
  name: 'lizard',
  supportsFilesystem: true,
  supportsStreaming: true,
  supportsProcesses: false,
  ports: [3000],
  timeout: 60000,
  skipIntegration: process.env.LIZARD_LIVE_TESTS !== '1',
});
