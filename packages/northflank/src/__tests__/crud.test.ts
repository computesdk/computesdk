import { runProviderCrudTest } from '@computesdk/test-utils';
import { northflank } from '../index';
import { liveConfig, skipLive } from './live-config';

runProviderCrudTest({
  name: 'northflank',
  provider: northflank(liveConfig()),
  timeout: 120_000,
  skipIntegration: skipLive,
});
