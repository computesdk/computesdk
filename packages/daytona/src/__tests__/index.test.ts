import { runProviderTestSuite } from '@computesdk/test-utils';
import { daytona } from '../index';

runProviderTestSuite({
  name: 'Daytona',
  provider: daytona({}),
  supportsFilesystem: false, // Daytona filesystem not implemented yet
  supportsTerminal: false,   // Daytona terminal not implemented yet
  supportsPython: true,      // Daytona supports Python
  skipIntegration: !process.env.DAYTONA_API_KEY
});