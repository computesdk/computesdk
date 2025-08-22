import { runProviderTestSuite } from '@computesdk/test-utils';
import { runloop } from '../index';

runProviderTestSuite({
  name: 'runloop',
  provider: runloop({}),
  supportsFilesystem: true,  // Runloop supports filesystem operations
  supportsPython: true,      // Runloop supports Python runtime
  skipIntegration: !process.env.RUNLOOP_API_KEY
});