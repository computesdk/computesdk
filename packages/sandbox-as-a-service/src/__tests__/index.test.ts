/**
 * Sandbox as a Service provider tests.
 *
 * Runs the shared provider suite, which covers the sandbox lifecycle, command
 * execution and the filesystem operations. Integration tests need AAS_API_KEY
 * and are skipped without it.
 */

import { runProviderTestSuite } from '@computesdk/test-utils';
import { sandboxAsAService } from '../index';

runProviderTestSuite({
  name: 'sandbox-as-a-service',
  // Config is empty on purpose: the key comes from AAS_API_KEY, which is how
  // the suite runs in CI.
  provider: sandboxAsAService({}),
  // Files move through a dedicated endpoint rather than through the shell.
  supportsFilesystem: true,
  skipIntegration: !process.env.AAS_API_KEY,
});
