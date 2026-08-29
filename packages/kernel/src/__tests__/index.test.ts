import { runBrowserProviderTestSuite } from '@computesdk/test-utils';
import { kernel } from '../index';

runBrowserProviderTestSuite({
  name: 'kernel',
  provider: kernel({}),
  skipIntegration: !process.env.KERNEL_API_KEY,
});
