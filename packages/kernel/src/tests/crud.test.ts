import { runProviderCrudTest } from '@computesdk/test-utils';
import { kernel } from '../index';

runProviderCrudTest({
  name: 'kernel',
  provider: kernel({}), // Uses KERNEL_API_KEY from env
  skipIntegration: !process.env.KERNEL_API_KEY
});