import path from 'path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    // `*.node.test.ts` are run by `node --test` rather than vitest: the
    // transport has no dependencies and its tests should not acquire any,
    // so they use `node:test` and are exercised by givemeanode's own CI
    // as well as here. `pnpm test:node` runs them.
    exclude: ['**/node_modules/**', '**/dist/**', '**/*.node.test.ts'],
    coverage: {
      reporter: ['text', 'json', 'html'],
      exclude: ['node_modules/', 'dist/', '**/*.d.ts', '**/*.config.*'],
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})
