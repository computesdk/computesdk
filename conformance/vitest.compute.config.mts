import { defineConfig } from 'vitest/config';

// No provider-unit setup files, resolver aliases or mocks.
export default defineConfig({
  test: {
    include: ['conformance/compute-native.test.ts'],
    environment: 'node',
    fileParallelism: false,
    retry: 0,
    bail: 1,
  },
});
