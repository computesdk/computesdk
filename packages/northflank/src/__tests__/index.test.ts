import { runProviderTestSuite } from '@computesdk/test-utils';
import { northflank } from '../index';
import { liveConfig, skipLive } from './live-config';

runProviderTestSuite({
  name: 'northflank',
  provider: northflank(liveConfig()),
  supportsFilesystem: true,
  skipIntegration: skipLive,
  ports: [3000],
});
