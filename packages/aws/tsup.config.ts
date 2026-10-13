import { defineConfig } from 'tsup';

export default defineConfig({
  entry: { 'ec2/index': 'src/ec2/index.ts' },
  format: ['cjs', 'esm'],
  dts: true,
  clean: true,
  sourcemap: true,
});
