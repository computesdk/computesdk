import { runProviderCrudTest } from '@computesdk/test-utils';
import { boat } from '../index';

runProviderCrudTest({
  name: 'boat',
  provider: boat({ createOptions: { type: 'small', noEnv: true }, timeout: 300_000 }),
  skipIntegration: !process.env.BOAT_API_KEY,
  timeout: 90_000,
});
