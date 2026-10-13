import { defineConfig } from 'tsup'

export default defineConfig([
  {
    entry: { 'cloud-run/index': 'src/cloud-run/index.ts' },
    format: ['cjs', 'esm'],
    dts: true,
    splitting: false,
    sourcemap: true,
    clean: true,
  },
  {
    entry: {
      'cloud-run/setup': 'src/cloud-run/setup.ts',
      'cloud-run/gateway': 'src/cloud-run/gateway.ts',
    },
    format: ['esm'],
    splitting: false,
    sourcemap: false,
    clean: false,
    banner: { js: '#!/usr/bin/env node' },
  },
])
