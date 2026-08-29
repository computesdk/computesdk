import { runProviderTestSuite } from '@computesdk/test-utils';
import { lelantos } from '../index';

// The integration leg runs only when LELANTOS_API_KEY is set, and threads
// `domain` (LELANTOS_DOMAIN, default 'lelantos.ai') into every e2b call so the
// suite hits the Lelantos control plane — NOT api.e2b.app. Without a key,
// skipIntegration is true: the suite swaps in its own internal mock sandbox, so
// it verifies the provider is constructible and shaped correctly, but does NOT
// exercise the Lelantos provider's real create/runCommand/filesystem code — that
// is only covered when an API key is present and the integration leg runs.
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
