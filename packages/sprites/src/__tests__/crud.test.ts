import { runProviderCrudTest } from '@computesdk/test-utils';
import { sprites } from '../index';

runProviderCrudTest({
  name: 'sprites',
  provider: sprites({}),
  skipIntegration: !process.env.SPRITES_TOKEN
});
