import { runProviderTestSuite } from '@computesdk/test-utils';
import { freestyle } from '../index';

runProviderTestSuite({
  name: 'freestyle',
  provider: freestyle({}),
  supportsFilesystem: true,
  skipIntegration: !process.env.FREESTYLE_API_KEY,
  ports: [3000, 8080]
});
