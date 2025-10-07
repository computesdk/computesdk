import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    testTimeout: 120000, // Docker operations can be slower
    hookTimeout: 30000,
  },
});
