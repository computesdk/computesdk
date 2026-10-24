import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['cjs', 'esm'],
  dts: true,
  splitting: false,
  sourcemap: true,
  clean: true,
  // The Sandock SDK (`sandock`) is ESM-only. Bundle it so this package's
  // CommonJS export remains usable on every Node version supported by ComputeSDK.
  noExternal: ['sandock'],
  esbuildOptions(options, context) {
    // Bundling the SDK pulls in `ws` (used by its PTY client), whose CommonJS
    // sources call `require`. The ESM output has no `require`, so give it one.
    if (context.format === 'esm') {
      options.banner = {
        js: [
          "import { createRequire as __createRequire } from 'node:module';",
          'const require = __createRequire(import.meta.url);',
        ].join('\n'),
      }
    }
  },
})
