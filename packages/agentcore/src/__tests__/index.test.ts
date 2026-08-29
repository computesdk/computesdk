import { runProviderTestSuite } from '@computesdk/test-utils';
import { agentcore } from '../index';

// Integration tests run when AWS credentials + region are available.
// AgentCore resolves credentials via the standard AWS chain (env, SSO, profile).
const region = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION;
const hasCredentials = Boolean(
  region &&
    (process.env.AWS_ACCESS_KEY_ID || process.env.AWS_PROFILE || process.env.AWS_SESSION_TOKEN),
);

runProviderTestSuite({
  name: 'agentcore',
  provider: agentcore({ region }),
  supportsFilesystem: true,
  // AgentCore has no inbound ports / preview URLs.
  supportsGetUrl: false,
  skipIntegration: !hasCredentials,
});
