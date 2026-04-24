import { runProviderTestSuite } from '@computesdk/test-utils';
import { prime } from '../index';

runProviderTestSuite({
  name: 'prime',
  provider: prime({}),
  supportsFilesystem: false,
  skipIntegration: !process.env.PRIME_API_KEY,
});
