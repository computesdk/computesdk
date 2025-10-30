import { runProviderTestSuite } from '@computesdk/test-utils';
import { daytona } from '../index';

runProviderTestSuite({
  name: 'daytona',
  provider: daytona({}),
  supportsFilesystem: true,  // Daytona supports filesystem operations
  skipIntegration: !process.env.DAYTONA_API_KEY
});