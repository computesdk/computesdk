import { runProviderTestSuite } from '@computesdk/test-utils';
import { modal } from '../index';

runProviderTestSuite({
  name: 'modal',
  provider: modal({}), // Let Modal SDK pick up environment variables directly
  supportsFilesystem: true,  // Modal supports filesystem operations
  supportsPython: true,      // Modal supports Python runtime (primary)
  skipIntegration: !process.env.MODAL_TOKEN_ID || !process.env.MODAL_TOKEN_SECRET
});