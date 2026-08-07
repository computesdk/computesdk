import { runProviderTestSuite } from '@computesdk/test-utils';
import { vercel } from '../index';

runProviderTestSuite({
  name: 'vercel',
  provider: vercel({}),
  supportsFilesystem: false,   // Vercel sandboxes don't support filesystem operations
  // V2 authenticates via OIDC/environment credentials; integration tests need a live OIDC token.
  skipIntegration: !process.env.VERCEL_OIDC_TOKEN,
  // Note: Vercel blocks certain ports (80, 443, 8080). Use allowed ports for getUrl tests.
  ports: [3000, 8000],
});