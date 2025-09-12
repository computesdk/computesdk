import { runProviderTestSuite } from '@computesdk/test-utils';
import { blaxel } from '../index';

runProviderTestSuite({
  name: 'blaxel',
  provider: blaxel({}),
  supportsFilesystem: true,   // Blaxel supports filesystem operations via fs API
  //skipIntegration: !process.env.BL_API_KEY && !process.env.BL_WORKSPACE
}); 