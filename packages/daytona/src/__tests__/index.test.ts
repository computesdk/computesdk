import { runProviderTestSuite } from '@computesdk/test-utils';
import { daytona } from '../index';

runProviderTestSuite({
  name: 'Daytona',
  provider: daytona({}),
  supportsFilesystem: true,  // Daytona supports filesystem operations
  supportsPython: true,      // Daytona supports Python runtime
  skipIntegration: !process.env.DAYTONA_API_KEY
});