import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  dts: true,
  clean: true,
  sourcemap: true,
  external: ['vitest'],
  // Use build-time-only tsconfig
  tsconfig: './config/tsconfig.json'
});