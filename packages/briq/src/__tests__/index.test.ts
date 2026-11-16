import { runProviderTestSuite } from '@computesdk/test-utils';
import { briq } from '../index';

runProviderTestSuite({
  name: 'briq',
  provider: briq({ apiKey: process.env.BRIQ_API_KEY }),
  supportsFilesystem: true,
  supportsStreaming: true,
  supportsProcesses: true,
  skipIntegration: !process.env.BRIQ_API_KEY,
});
