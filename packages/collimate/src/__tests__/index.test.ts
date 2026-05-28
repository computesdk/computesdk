import { runProviderTestSuite } from '@computesdk/test-utils';
import { collimate } from '../index';

runProviderTestSuite({
  name: 'collimate',
  provider: collimate({
    serverUrl: process.env.COLLIMATE_SERVER_URL || 'https://api.collimate.ai',
    apiKey: process.env.COLLIMATE_API_KEY,
    templateId: process.env.COLLIMATE_TEMPLATE_ID || 'node',
  }),
  supportsFilesystem: true,
  skipIntegration: !process.env.COLLIMATE_API_KEY,
  supportsGetUrl: false,
});
