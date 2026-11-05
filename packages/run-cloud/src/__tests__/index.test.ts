import { runProviderTestSuite } from '@computesdk/test-utils';
import { runCloud } from '../index';

const hasCredentials = Boolean(
  process.env.RUN_CLOUD_API_KEY || process.env.RUN_CLOUD_API_TOKEN
);

runProviderTestSuite({
  name: 'run-cloud',
  provider: runCloud({}),
  supportsFilesystem: true,
  supportsGetUrl: true,
  supportsStreaming: true,
  supportsProcesses: true,
  // Tiers are only resolved on a live sandbox.
  expectProcessRuntime: hasCredentials
    ? { streaming: 'native', processes: 'shell' }
    : undefined,
  skipIntegration: !hasCredentials,
});
