import { runProviderTestSuite } from '@computesdk/test-utils';
import { exeDev } from '../index';

runProviderTestSuite({
  name: 'exe-dev',
  provider: exeDev({}),
  // No native file API: the framework's shell filesystem runs over runCommand.
  supportsFilesystem: true,
  skipIntegration: !process.env.EXE_API_KEY,
});
