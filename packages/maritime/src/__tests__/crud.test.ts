import { runProviderCrudTest } from '@computesdk/test-utils';
import { maritime } from '../index';

runProviderCrudTest({
  name: 'maritime',
  provider: maritime({}),
  skipIntegration: !process.env.MARITIME_API_KEY,
});
