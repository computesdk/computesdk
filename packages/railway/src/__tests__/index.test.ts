import { runProviderTestSuite } from '@computesdk/test-utils';
import { railway } from '../index';

const skipIntegration = !process.env.RAILWAY_API_TOKEN;

runProviderTestSuite({
  name: 'railway',
  provider: railway({}),
  supportsFilesystem: true, // implemented over the shell via exec
  supportsGetUrl: false, // Railway sandboxes do not expose public per-port URLs
  // `sandbox.exec` streams output natively; background processes run on the shell tier.
  supportsStreaming: true,
  supportsProcesses: true,
  // The mock sandbox reports no runtime, so the tier is only checked live.
  ...(skipIntegration ? {} : { expectProcessRuntime: { streaming: 'native', processes: 'shell' } as const }),
  skipIntegration,
});
