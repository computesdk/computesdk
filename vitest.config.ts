import { defineConfig } from 'vitest/config'
import { config } from 'dotenv'

// Load environment variables from .env file
config()

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    coverage: {
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/',
        'dist/',
        '**/*.d.ts',
        '**/*.config.*',
        '**/mockData.ts',
        'examples/'
      ]
    }
  }
})