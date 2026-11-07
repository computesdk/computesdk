import { runProviderTestSuite } from '@computesdk/test-utils';
import { freestyle } from '../index';

runProviderTestSuite({
  name: 'freestyle',
  provider: freestyle({}),
  // Freestyle VMs are full Linux guests with a real filesystem.
  supportsFilesystem: true,
  // Freestyle exposes VMs through mapped domains, not a stock per-port URL.
  supportsGetUrl: false,
  // Full Linux guests run the shared POSIX-shell tier for live output and processes.
  supportsStreaming: true,
  supportsProcesses: true,
  // Native pause keeps memory; snapshots capture the whole VM and leave the source running.
  supportsPauseResume: true,
  supportsSnapshots: true,
  // Integration tests need an API key; the runtime snapshot is baked on first use.
  skipIntegration: !process.env.FREESTYLE_API_KEY,
});
