import { runProviderTestSuite } from '@computesdk/test-utils';
import { dockerSandboxes } from '../index';

runProviderTestSuite({
  name: 'docker-sandboxes',
  provider: dockerSandboxes({}),
  supportsGetUrl: false,
  skipIntegration: !process.env.DOCKER_SANDBOXES_TOKEN,
});
