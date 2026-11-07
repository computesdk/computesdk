import { runProviderTestSuite } from '@computesdk/test-utils';
import { e2b } from '../index';

runProviderTestSuite({
  name: 'e2b',
  provider: e2b({}),
  supportsFilesystem: true,  // E2B supports filesystem operations
  // envd streams output, takes stdin and kills: both are served natively.
  supportsStreaming: true,
  supportsProcesses: true,
  expectProcessRuntime: { streaming: 'native', processes: 'native' },
  // Pause keeps memory and the filesystem; snapshots capture the whole rootfs.
  supportsPauseResume: true,
  supportsSnapshots: true,
  skipIntegration: !process.env.E2B_API_KEY,
  ports: [3000, 8080]  // Enable getUrl tests
});