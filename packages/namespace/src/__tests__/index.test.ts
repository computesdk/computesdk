import { runProviderTestSuite } from '@computesdk/test-utils';
import { namespace } from '../index';

runProviderTestSuite({
  name: 'namespace',
  provider: namespace({}), // Uses NSC_TOKEN from env
  // Namespace streams over CommandService.RunCommand, so no exposed port is needed.
  supportsStreaming: true,
  // RunCommand has no stdin or signal channel, so processes run on the shell tier.
  supportsProcesses: true,
  // The mock sandbox reports no runtime, so the tiers are only asserted live.
  expectProcessRuntime: process.env.NSC_TOKEN ? { streaming: 'native', processes: 'shell' } : undefined,
  // No native file API; the provider's shell filesystem covers it.
  supportsFilesystem: true,
  supportsGetUrl: false,
  skipIntegration: !process.env.NSC_TOKEN,
});
