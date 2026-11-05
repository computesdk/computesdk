import { runProviderTestSuite } from '@computesdk/test-utils';
import { codesandbox } from '../index';

const live = Boolean(process.env.CSB_API_KEY);

runProviderTestSuite({
  name: 'codesandbox',
  provider: codesandbox({}),
  supportsFilesystem: true,
  supportsStreaming: true,    // served by the shell process tier over runCommand
  supportsProcesses: true,
  expectProcessRuntime: live ? { streaming: 'shell', processes: 'shell' } : undefined,
  skipIntegration: !live
});
