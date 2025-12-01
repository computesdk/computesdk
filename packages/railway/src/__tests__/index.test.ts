import { runProviderTestSuite } from '@computesdk/test-utils';
import { railway } from '../index';

runProviderTestSuite({
  name: 'railway',
  provider: railway({}),
  supportsFilesystem: false,
  skipIntegration: !process.env.RAILWAY_API_KEY || !process.env.RAILWAY_PROJECT_ID || !process.env.RAILWAY_ENVIRONMENT_ID
});