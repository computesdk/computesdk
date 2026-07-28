import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['cjs', 'esm'],
  dts: true,
  splitting: false,
  sourcemap: true,
  clean: true,
  // sandbox0 is ESM-only. Bundling it keeps the provider's documented
  // CommonJS entry usable on every Node version supported by ComputeSDK.
  noExternal: ['sandbox0'],
})
