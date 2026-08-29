import { runProviderTestSuite } from '@computesdk/test-utils';
import { upstash } from '../index';

runProviderTestSuite({
  name: 'upstash',
  provider: upstash({}),
  supportsFilesystem: true,
  skipIntegration: !process.env.UPSTASH_BOX_API_KEY,
  ports: [3000, 8080]
});
