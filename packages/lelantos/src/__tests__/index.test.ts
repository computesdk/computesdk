import { runProviderTestSuite } from '@computesdk/test-utils';
import { lelantos } from '../index';

// The integration leg runs only when LELANTOS_API_KEY is set, and threads
// `domain` (LELANTOS_DOMAIN, default 'lelantos.ai') into every e2b call so the
// suite hits the Lelantos control plane — NOT api.e2b.app. In mock mode
// (no key) the provider object is still exercised against the full interface.
runProviderTestSuite({
  name: 'lelantos',
  provider: lelantos({
    apiKey: process.env.LELANTOS_API_KEY,
    domain: process.env.LELANTOS_DOMAIN || 'lelantos.ai',
  }),
  supportsFilesystem: true,  // Lelantos supports filesystem operations
  skipIntegration: !process.env.LELANTOS_API_KEY,
  ports: [3000, 8080]  // Enable getUrl tests
});
