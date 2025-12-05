import { runProviderCrudTest } from '@computesdk/test-utils';
import { modal } from '../index';

runProviderCrudTest({
  name: 'modal',
  provider: modal({}), // Uses MODAL_TOKEN_ID and MODAL_TOKEN_SECRET from env
  skipIntegration: !process.env.MODAL_TOKEN_ID || !process.env.MODAL_TOKEN_SECRET
});