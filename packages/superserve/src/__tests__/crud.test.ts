import { runProviderCrudTest } from '@computesdk/test-utils';
import { superserve } from '../index';

runProviderCrudTest({
  name: 'superserve',
  provider: superserve({}),
  skipIntegration: !process.env.SUPERSERVE_API_KEY,
});
