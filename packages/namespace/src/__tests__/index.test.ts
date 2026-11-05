import { runProviderTestSuite } from '@computesdk/test-utils';
import { namespace } from '../index';

runProviderTestSuite({
  name: 'namespace',
  provider: namespace({}), // Uses NSC_TOKEN from env
  // Namespace streams over CommandService.RunCommand, so no exposed port is needed.
  supportsStreaming: true,
  supportsGetUrl: false,
  skipIntegration: !process.env.NSC_TOKEN,
});
