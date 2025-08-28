import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.{test,spec}.{js,ts}'],
    exclude: [
      'node_modules/**',
      'dist/**',
      'worker/**',
      'test-sandbox-worker/**',
      '**/*.d.ts',
      '**/*.config.*'
    ],
    coverage: {
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/',
        'dist/',
        'worker/',
        'test-sandbox-worker/',
        '**/*.d.ts',
        '**/*.config.*'
      ]
    },
    // Support for top-level await in tests
    pool: 'forks'
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src')
    }
  },
  // Allow ES modules and dynamic imports
  esbuild: {
    target: 'node18'
  }
})