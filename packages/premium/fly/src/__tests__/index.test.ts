import { runProviderTestSuite } from '@computesdk/test-utils';
import { flyio } from '../index';

runProviderTestSuite({
  name: 'flyio',
  provider: flyio({
    apiToken: process.env.FLY_API_TOKEN,
    org: process.env.FLY_ORG
  }),
  supportsFilesystem: true,  // Fly supports filesystem operations via SSH
  supportsPython: true,      // Fly supports Python runtime (also supports Node.js)
  skipIntegration: !process.env.FLY_API_TOKEN || !process.env.FLY_ORG
});