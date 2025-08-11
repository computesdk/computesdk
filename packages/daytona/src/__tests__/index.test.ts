import { runProviderTestSuite } from '@computesdk/test-utils';
import { daytona } from '../index';

runProviderTestSuite({
  name: 'Daytona',
  provider: daytona({}),
  supportsFilesystem: true,  // Daytona filesystem implemented via terminal commands
  supportsTerminal: false,   // Daytona terminal needs verification of session API streaming
  supportsPython: true,      // Daytona supports Python
  skipIntegration: !process.env.DAYTONA_API_KEY
});