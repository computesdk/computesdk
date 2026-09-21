import { runProviderCrudTest } from '@computesdk/test-utils';
import { novita } from '../index';

const runLive = process.env.NOVITA_RUN_INTEGRATION === '1' && Boolean(process.env.NOVITA_API_KEY);

runProviderCrudTest({
  name: 'novita',
  provider: novita({}),
  skipIntegration: !runLive,
  timeout: 90_000,
});
