import { runProviderCrudTest } from '@computesdk/test-utils';
import { freestyle } from '../index';

runProviderCrudTest({
  name: 'freestyle',
  provider: freestyle({}),
  skipIntegration: !process.env.FREESTYLE_API_KEY
});
