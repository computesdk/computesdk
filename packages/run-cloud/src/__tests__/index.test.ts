import { runProviderTestSuite } from '@computesdk/test-utils';
import { runCloud } from '../index';

runProviderTestSuite({
  name: 'run-cloud',
  provider: runCloud({}),
  supportsFilesystem: true,
  supportsGetUrl: false,
  skipIntegration: !(
    process.env.RUN_CLOUD_API_KEY || process.env.RUN_CLOUD_API_TOKEN
  ),
});
