import { runProviderTestSuite } from '@computesdk/test-utils';
import { modal } from '../index';

runProviderTestSuite({
  name: 'Modal',
  provider: modal({}),
  supportsFilesystem: true,  // Modal supports filesystem operations
  supportsPython: true,      // Modal supports Python runtime (primary)
  skipIntegration: !process.env.MODAL_TOKEN_ID || !process.env.MODAL_TOKEN_SECRET
});