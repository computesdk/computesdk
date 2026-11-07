import { describe, expect, it } from 'vitest';
import { modal } from '../index';

const skip = !process.env.MODAL_PROFILE && (!process.env.MODAL_TOKEN_ID || !process.env.MODAL_TOKEN_SECRET);

describe.skipIf(skip)('Modal command output over a quiet interval', () => {
  it.each(['gvisor', 'vm'])('keeps all stdout and stderr on %s', async runtime => {
    const provider = modal({ appName: 'libmodal-test', environment: process.env.MODAL_ENVIRONMENT, timeout: 180000 });
    const sandbox = await provider.sandbox.create(runtime === 'vm' ? { runtime: 'vm' } : {});
    try {
      // Leave both streams quiet longer than the interval that exposed output
      // loss in CPU benchmarks, then write more than a pipe buffer to each.
      const command = `
printf 'before🌍\\n'
printf 'before-error🌍\\n' >&2
sleep 35
printf 'middle🌍\\n'
printf 'middle-error🌍\\n' >&2
head -c 1048576 /dev/zero | tr '\\000' x
head -c 1048576 /dev/zero | tr '\\000' e >&2
printf '\\nend🌍\\n'
printf '\\nend-error🌍\\n' >&2
exit 7
`;
      const result = await sandbox.runCommand(command, { timeout: 90000 });
      expect(result.exitCode).toBe(7);
      expect(result.stdout).toBe('before🌍\nmiddle🌍\n' + 'x'.repeat(1048576) + '\nend🌍\n');
      expect(result.stderr).toBe('before-error🌍\nmiddle-error🌍\n' + 'e'.repeat(1048576) + '\nend-error🌍\n');
    } finally {
      await sandbox.destroy();
    }
  }, 180000);
});
