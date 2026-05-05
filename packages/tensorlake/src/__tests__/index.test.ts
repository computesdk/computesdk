import { runProviderTestSuite } from '@computesdk/test-utils';
import { tensorlake } from '../index';

runProviderTestSuite({
  name: 'tensorlake',
  provider: tensorlake({}),
  supportsFilesystem: true,
  // Skip integration tests unless an explicit API key is provided and SKIP_INTEGRATION=false.
  // This avoids dependency on external Tensorlake infrastructure for local development.
  skipIntegration:
    process.env.SKIP_INTEGRATION === 'true' || !process.env.TENSORLAKE_API_KEY,
  ports: [3000, 8080],
});
