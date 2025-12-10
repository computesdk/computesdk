import { runProviderCrudTest } from '@computesdk/test-utils';
import { e2b } from '../index';

runProviderCrudTest({
  name: 'e2b',
  provider: e2b({}), // Uses E2B_API_KEY from env
  skipIntegration: !process.env.E2B_API_KEY
});