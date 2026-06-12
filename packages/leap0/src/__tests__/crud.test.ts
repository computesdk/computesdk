import { runProviderCrudTest } from '@computesdk/test-utils';
import { leap0 } from '../index';

runProviderCrudTest({
  name: 'leap0',
  provider: leap0({}),
  skipIntegration: !process.env.LEAP0_API_KEY,
});
