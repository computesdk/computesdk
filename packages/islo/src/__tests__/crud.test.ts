import { runProviderCrudTest } from '@computesdk/test-utils';
import { islo } from '../index';

runProviderCrudTest({
  name: 'islo',
  provider: islo({}),
  skipIntegration: !process.env.ISLO_API_URL || !process.env.ISLO_BEARER_TOKEN,
});
