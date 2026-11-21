import { runProviderTestSuite } from '@computesdk/test-utils';
import { platinum } from '../index';

runProviderTestSuite({
  name: 'platinum',
  provider: platinum({}),
  supportsFilesystem: true,
  skipIntegration: !(process.env.PLATINUM_API_KEY || process.env.PT_TOKEN),
});
