import { runProviderTestSuite } from '@computesdk/test-utils';
import { islo } from '../index';

runProviderTestSuite({
  name: 'islo',
  provider: islo({}),
  supportsFilesystem: false,
  skipIntegration: !process.env.ISLO_API_URL || !process.env.ISLO_BEARER_TOKEN,
});
