import { runProviderTestSuite } from '@computesdk/test-utils';
import { prime } from '../index';

runProviderTestSuite({
  name: 'prime',
  provider: prime({
    apiKey: process.env.PRIME_API_KEY,
    teamId: process.env.PRIME_TEAM_ID,
  }),
  supportsFilesystem: false,
  supportsGetUrl: false,
  skipIntegration: !process.env.PRIME_API_KEY,
  timeout: 180_000,
});
