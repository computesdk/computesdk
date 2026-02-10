import { runProviderTestSuite } from '@computesdk/test-utils';
import { e2b } from '../index';

runProviderTestSuite({
  name: 'e2b',
  provider: e2b({}),
  supportsFilesystem: true,  // E2B supports filesystem operations
  skipIntegration: !process.env.E2B_API_KEY,
  ports: [3000, 8080]  // Enable getUrl tests
});