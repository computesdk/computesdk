import { runProviderTestSuite } from '@computesdk/test-utils';
import { asciiBox } from '../index';

runProviderTestSuite({
  name: 'asciibox',
  provider: asciiBox({}),
  supportsFilesystem: true,
  supportsGetUrl: true,
  skipIntegration: !process.env.ASCIIBOX_API_KEY,
  ports: [3000, 8080],
});
