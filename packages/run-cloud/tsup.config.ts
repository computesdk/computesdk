import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['cjs', 'esm'],
  dts: true,
  splitting: false,
  sourcemap: true,
  clean: true,
  // The official SDK is ESM-only. Bundle it so this package's CommonJS export
  // remains usable on every Node version supported by ComputeSDK.
  noExternal: ['@run-cloud/sdk'],
})
