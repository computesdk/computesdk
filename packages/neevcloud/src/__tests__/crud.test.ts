import { runProviderCrudTest } from '@computesdk/test-utils';
import { neevcloud } from '../index';

runProviderCrudTest({
  name: 'neevcloud',
  provider: neevcloud({}), // Uses NEEV_API_KEY from env
  skipIntegration: !process.env.NEEV_API_KEY,
});
