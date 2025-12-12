import { runProviderCrudTest } from '@computesdk/test-utils';
import { namespace } from '../index';

runProviderCrudTest({
  name: 'namespace',
  provider: namespace({}), // Uses NSC_TOKEN from env
  skipIntegration: !process.env.NSC_TOKEN
});
