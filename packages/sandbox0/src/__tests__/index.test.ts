import { runProviderTestSuite } from '@computesdk/test-utils';
import { sandbox0 } from '../index';

runProviderTestSuite({
  name: 'sandbox0',
  provider: sandbox0({
    token: process.env.SANDBOX0_TOKEN,
    teamId: process.env.SANDBOX0_TEAM_ID,
    baseUrl: process.env.SANDBOX0_BASE_URL,
    templateId: process.env.SANDBOX0_TEMPLATE,
    hardTtl: 600,
  }),
  supportsFilesystem: true,
  supportsGetUrl: false,
  skipIntegration: !process.env.SANDBOX0_TOKEN,
  filesystemBasePath: '/tmp',
  timeout: 60_000,
});
