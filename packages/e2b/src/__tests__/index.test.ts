import { runProviderTestSuite } from '@computesdk/test-utils';
import { e2b } from '../index';

runProviderTestSuite({
  name: 'E2B',
  provider: e2b({}),
  supportsFilesystem: true,
  supportsTerminal: true,
  supportsPython: true,
  skipIntegration: !process.env.E2B_API_KEY
});