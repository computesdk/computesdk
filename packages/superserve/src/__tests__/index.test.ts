import { runProviderTestSuite } from '@computesdk/test-utils';
import { superserve } from '../index';

runProviderTestSuite({
  name: 'superserve',
  provider: superserve({}),
  supportsFilesystem: true,
  supportsGetUrl: false,
  skipIntegration: !process.env.SUPERSERVE_API_KEY,
});
