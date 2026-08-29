import { runProviderTestSuite } from '@computesdk/test-utils';
import { freestyle } from '../index';

runProviderTestSuite({
  name: 'freestyle',
  provider: freestyle({}),
  // Freestyle VMs are full Linux guests with a real filesystem.
  supportsFilesystem: true,
  // Integration tests need an API key and a runtime snapshot to boot from.
  skipIntegration: !process.env.FREESTYLE_API_KEY || !process.env.FREESTYLE_SNAPSHOT_ID,
});
