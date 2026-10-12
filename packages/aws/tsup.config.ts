import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    'agentcore/index': 'src/agentcore/index.ts',
    'ec2/index': 'src/ec2/index.ts',
  },
  format: ['cjs', 'esm'],
  dts: true,
  clean: true,
  sourcemap: true,
});
