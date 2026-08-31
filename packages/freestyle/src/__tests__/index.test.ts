import { runProviderTestSuite } from '@computesdk/test-utils';
import { freestyle } from '../index';

runProviderTestSuite({
  name: 'freestyle',
  provider: freestyle({}),
  // Freestyle VMs are full Linux guests with a real filesystem.
  supportsFilesystem: true,
  // Freestyle exposes VMs through mapped domains, not a stock per-port URL.
  supportsGetUrl: false,
  // Integration tests need an API key; the runtime snapshot is baked on first use.
  skipIntegration: !process.env.FREESTYLE_API_KEY,
});
