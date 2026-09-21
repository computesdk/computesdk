import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['cjs', 'esm'],
  dts: true,
  splitting: false,
  noExternal: ['@infercrane/brezel'],
  sourcemap: true,
  clean: true,
})
