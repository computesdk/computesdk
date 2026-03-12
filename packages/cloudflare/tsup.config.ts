import { defineConfig } from 'tsup'

export default defineConfig([
  {
    entry: ['src/index.ts'],
    format: ['cjs', 'esm'],
    dts: true,
    splitting: false,
    sourcemap: true,
    clean: true,
  },
  {
    entry: ['src/setup.ts'],
    format: ['esm'],
    splitting: false,
    sourcemap: false,
    clean: false,
    banner: { js: '#!/usr/bin/env node' },
  },
])