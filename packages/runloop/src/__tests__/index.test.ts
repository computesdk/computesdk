import { runProviderTestSuite } from '@computesdk/test-utils';
import { runloop } from '../index';

runProviderTestSuite({
  name: 'runloop',
  provider: runloop({}),
  supportsFilesystem: true,  // Runloop supports filesystem operations
  ports: [3000],
  skipIntegration: !process.env.RUNLOOP_API_KEY
});
