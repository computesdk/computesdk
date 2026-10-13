import { defineConfig } from 'tsup';

export default defineConfig([
  {
    entry: { 'ec2/index': 'src/ec2/index.ts' },
    format: ['cjs', 'esm'],
    dts: true,
    clean: true,
    sourcemap: true,
  },
  {
    entry: { 'ec2/gateway': 'src/ec2/gateway/cli.ts' },
    format: ['esm'],
    clean: false,
    sourcemap: false,
    banner: { js: '#!/usr/bin/env node' },
  },
]);
