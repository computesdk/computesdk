import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      'cloudflare:workers': fileURLToPath(
        new URL('./src/__tests__/cloudflare-workers.ts', import.meta.url)
      ),
    },
  },
  test: {
    include: ['src/__tests__/**/*.test.ts'],
  },
});
