import { runProviderCrudTest } from '@computesdk/test-utils';
import { render } from '../index';

runProviderCrudTest({
  name: 'render',
  provider: render({}), // Uses RENDER_API_KEY and RENDER_OWNER_ID from env
  skipIntegration: !process.env.RENDER_API_KEY || !process.env.RENDER_OWNER_ID
});