import { runProviderCrudTest } from '@computesdk/test-utils';
import { prime } from '../index';

runProviderCrudTest({
  name: 'prime',
  provider: prime({}),
  skipIntegration: !process.env.PRIME_API_KEY,
});
