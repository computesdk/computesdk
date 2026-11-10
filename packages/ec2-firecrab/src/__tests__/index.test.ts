import { runProviderTestSuite } from '@computesdk/test-utils';
import { ec2Firecrab } from '../index.js';

// Live runs need a reachable firecrab host (EC2_FIRECRAB_SSH_TARGET(S) +
// EC2_FIRECRAB_SSH_KEY, or EC2_FIRECRAB_API_URL for a caller-owned tunnel) and
// a MicroNetwork (EC2_FIRECRAB_MICRO_NETWORK name or _ID).
// No preview URLs yet (getUrl throws) and no filesystem API.
runProviderTestSuite({
  name: 'ec2-firecrab',
  provider: ec2Firecrab({}),
  supportsFilesystem: false,
  supportsGetUrl: false,
  supportsStreaming: true,
  supportsProcesses: true,
  skipIntegration: !(
    process.env.EC2_FIRECRAB_MICRO_NETWORK_ID || process.env.EC2_FIRECRAB_MICRO_NETWORK
  ),
  timeout: 180_000,
});
