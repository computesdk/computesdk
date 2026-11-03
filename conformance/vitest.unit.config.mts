import { defineConfig } from 'vitest/config';

// Explicit local harness self-tests. Never collect the native entrypoint.
export default defineConfig({
  test: {
    include: ['conformance/__tests__/compute-cleanup-probe.test.ts'],
    environment: 'node',
    minWorkers: 1,
    maxWorkers: 1,
    retry: 0,
    env: { COMPUTESDK_CONFORMANCE_NATIVE: '0' },
  },
});
