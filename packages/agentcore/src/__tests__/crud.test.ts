import { runProviderCrudTest } from '@computesdk/test-utils';
import { agentcore } from '../index';

const region = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION;
const hasCredentials = Boolean(
  region &&
    (process.env.AWS_ACCESS_KEY_ID || process.env.AWS_PROFILE || process.env.AWS_SESSION_TOKEN),
);

runProviderCrudTest({
  name: 'agentcore',
  provider: agentcore({ region }),
  skipIntegration: !hasCredentials,
});
