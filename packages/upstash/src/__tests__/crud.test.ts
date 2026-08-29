import { runProviderCrudTest } from '@computesdk/test-utils';
import { upstash } from '../index';

runProviderCrudTest({
  name: 'upstash',
  provider: upstash({}),
  skipIntegration: !process.env.UPSTASH_BOX_API_KEY
});
