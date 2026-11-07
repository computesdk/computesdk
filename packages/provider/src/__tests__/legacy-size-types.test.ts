import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { describe, it } from 'vitest';

describe('legacy provider sizing type compatibility', () => {
  it('compiles unrelated sizes extensions and strongly typed generated discovery without casts', () => {
    // Use the installed compiler offline. The fixture is typechecked, never executed.
    execFileSync(process.execPath, [require.resolve('typescript/bin/tsc'),
      '--noEmit', '--strict', '--target', 'es2020', '--moduleResolution', 'node',
      '--esModuleInterop', '--skipLibCheck', resolve(__dirname, 'legacy-size-types.ts'),
    ], { cwd: resolve(__dirname, '../..'), stdio: 'pipe', timeout: 25_000 });
  }, 30_000);
});
