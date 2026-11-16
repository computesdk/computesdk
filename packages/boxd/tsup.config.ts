import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['cjs', 'esm'],
  dts: true,
  splitting: false,
  sourcemap: true,
  clean: true,
  // @boxd-sh/sdk is ESM-only. Bundling it keeps the provider's documented
  // CommonJS entry usable on every Node version supported by ComputeSDK.
  noExternal: ['@boxd-sh/sdk'],
})
