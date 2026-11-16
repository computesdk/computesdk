import { defineConfig } from 'tsup'

const shared = {
  entry: ['src/index.ts'],
  splitting: false,
  sourcemap: true,
  dts: true,
}

export default defineConfig([
  { ...shared, format: ['esm'] },
  // @depot/sandbox is ESM-only (no `require` export), so the CJS build bundles it.
  { ...shared, format: ['cjs'], noExternal: ['@depot/sandbox'] },
])
