import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts', 'src/polyfills.ts', 'src/polyfills-auto.ts'],
  format: ['cjs', 'esm'],
  dts: true,
  splitting: false,
  sourcemap: true,
  clean: true,
})
