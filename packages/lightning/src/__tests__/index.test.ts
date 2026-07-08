import { runProviderTestSuite } from '@computesdk/test-utils';
import { lightning } from '../index';

runProviderTestSuite({
  name: 'lightning',
  provider: lightning({}),
  supportsFilesystem: true,
  // Lightning exposes a public HTTPS URL per port declared at create time,
  // surfaced through `getUrl` via the SDK's `getPortUrl`.
  supportsGetUrl: true,
  // Declare ports at create time so real sandboxes get public port URLs the
  // getUrl coverage (single port + custom protocol) can resolve.
  ports: [8080, 3000],
  skipIntegration: !process.env.LIGHTNING_API_KEY,
});
