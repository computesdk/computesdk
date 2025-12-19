import { defineConfig } from 'tsup'

export default defineConfig({
  entry: {
    index: 'src/cli/index.ts',
    'bin/workbench': 'src/bin/workbench.ts',
    helpers: 'src/helpers.ts',
  },
  format: ['esm'],
  dts: true,
  splitting: false,
  sourcemap: true,
  clean: true,
  shims: true,
})
