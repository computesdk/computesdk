import { defineConfig } from 'tsup'

export default defineConfig([
  {
    entry: ['src/index.ts'],
    format: ['esm', 'cjs'],
    dts: true,
    clean: true,
    external: ['@livestore/livestore', '@livestore/adapter-web'],
  },
  {
    entry: ['src/worker.ts'],
    format: ['esm'],
    dts: true,
    outDir: 'dist',
    external: ['@livestore/livestore', '@livestore/adapter-web'],
  },
])