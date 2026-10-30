import { runProviderTestSuite } from '@computesdk/test-utils';
import { beforeEach } from 'vitest';
import { boat } from '../index';

// The shared suite creates a sandbox per test. Pace starts below Boat's standard
// 12/minute account limit while keeping the common conformance checks unchanged.
beforeEach(async () => {
  if (process.env.BOAT_API_KEY) await new Promise(resolve => setTimeout(resolve, 5500));
});

runProviderTestSuite({
  name: 'boat',
  provider: boat({ createOptions: { type: 'small', noEnv: true }, timeout: 300_000 }),
  supportsFilesystem: true,
  supportsStreaming: true,
  supportsProcesses: true,
  skipIntegration: !process.env.BOAT_API_KEY,
  // Boat returns HTTPS preview URLs; omit the shared suite's custom-protocol case.
  ports: [3000],
  timeout: 90_000,
});
