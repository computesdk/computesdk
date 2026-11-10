import { runProviderTestSuite } from '@computesdk/test-utils';
import { agent37 } from '../index';

runProviderTestSuite({
  name: 'agent37',
  provider: agent37({}),
  supportsFilesystem: true,
  supportsStreaming: true,
  supportsProcesses: true,
  skipIntegration: !process.env.AGENT37_API_KEY,
});
