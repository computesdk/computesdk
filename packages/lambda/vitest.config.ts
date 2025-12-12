import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    testTimeout: 60000, // Increased timeout for cloud operations
  }
})