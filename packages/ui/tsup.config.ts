import { defineConfig } from 'tsup';

export default defineConfig({
  entry: [
    'src/index.ts',
    'adapters/react.tsx',
    'adapters/vue.ts',
    'adapters/svelte.ts',
    'adapters/vanilla.ts'
  ],
  format: ['esm'],
  dts: false, // Disable type generation for now due to React type issues
  clean: true,
  splitting: false,
  sourcemap: true,
  minify: false,
  external: ['react', 'vue'],
  treeshake: true
});