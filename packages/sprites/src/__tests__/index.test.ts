import { runProviderTestSuite } from '@computesdk/test-utils';
import { sprites } from '../index';

runProviderTestSuite({
  name: 'sprites',
  provider: sprites({}),
  supportsFilesystem: true,
  supportsStreaming: true,
  supportsProcesses: true,
  skipIntegration: !process.env.SPRITES_TOKEN,
  ports: [3000, 8080]
});
