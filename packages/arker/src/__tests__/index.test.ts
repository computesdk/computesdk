import { runProviderTestSuite } from '@computesdk/test-utils';
import { arker } from '../index';

runProviderTestSuite({
  name: 'arker',
  provider: arker({}),
  supportsFilesystem: true,   // Arker VMs are full OS environments with persistent filesystems
  supportsGetUrl: false,      // ports are exposed via run-time tunnel requests, not a static URL
  skipIntegration: !process.env.ARKER_API_KEY,
});
