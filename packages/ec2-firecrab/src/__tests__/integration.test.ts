import { runProviderTestSuite } from '@computesdk/test-utils';
import { ec2Firecrab } from '../index.js';

// Live runs need a reachable firecrab host: set EC2_FIRECRAB_API_URL (a
// tunnel/forward to the host's loopback listener), EC2_FIRECRAB_MICRO_NETWORK_ID,
// EC2_FIRECRAB_TEMPLATE, and — for off-host exec — EC2_FIRECRAB_SSH_PROXY_COMMAND.
runProviderTestSuite({
  name: 'ec2-firecrab',
  provider: ec2Firecrab({}),
  supportsFilesystem: false,
  skipIntegration: !process.env.EC2_FIRECRAB_MICRO_NETWORK_ID,
  timeout: 180_000,
});
