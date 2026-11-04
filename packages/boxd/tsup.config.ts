import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['cjs', 'esm'],
  dts: true,
  splitting: false,
  sourcemap: true,
  clean: true,
  // The official boxd SDK is ESM-only. Bundle it so this package's CommonJS export
  // works too. Its own dependencies (@grpc/grpc-js, @bufbuild/protobuf) are listed in
  // package.json, so they stay external.
  noExternal: ['@boxd-sh/sdk'],
  esbuildOptions(options, context) {
    // The ESM output has no `require`, and @grpc/grpc-js is CommonJS, so give it one.
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
