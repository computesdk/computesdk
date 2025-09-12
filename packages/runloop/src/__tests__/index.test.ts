import { runProviderTestSuite } from '@computesdk/test-utils';
import { runloop } from '../index';

runProviderTestSuite({
  name: 'runloop',
  provider: runloop({}),
  supportsFilesystem: true,  // Runloop supports filesystem operations
  skipIntegration: !process.env.RUNLOOP_API_KEY
});