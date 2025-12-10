import { runProviderTestSuite } from '@computesdk/test-utils';
import { namespace } from '../index';

runProviderTestSuite({
  name: 'namespace',
  provider: namespace({}),
  supportsFilesystem: false,
  skipIntegration: !process.env.NSC_TOKEN
});