import { runProviderTestSuite } from '@computesdk/test-utils';
import { docker } from '../index';

// Skip integration tests if Docker is not available
// This can be controlled via environment variable
const skipIntegration = process.env.SKIP_DOCKER_TESTS === 'true' || process.env.CI === 'true';

runProviderTestSuite({
  name: 'docker',
  provider: docker({}),
  supportsFilesystem: true,  // Docker supports filesystem operations
  skipIntegration,
  timeout: 120000 // Docker operations can be slower (container startup)
});
