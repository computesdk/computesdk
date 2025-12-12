import { runProviderCrudTest } from '@computesdk/test-utils';
import { avm } from '../index';

runProviderCrudTest({
  name: 'avm',
  provider: avm({}), // Uses AVM_API_KEY from env
  skipIntegration: !process.env.AVM_API_KEY
});