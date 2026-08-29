import { describe, it, expect, beforeEach, vi } from 'vitest';

// A spy standing in for the e2b sandbox's `commands.run`, so we can assert
// exactly what shell command the provider builds — without a real sandbox.
const { mockRun } = vi.hoisted(() => ({ mockRun: vi.fn() }));

vi.mock('e2b', () => {
  class CommandExitError extends Error {}
  class Sandbox {
    sandboxId = 'sbx_test';
    commands = { run: mockRun };
    static async create() { return new Sandbox(); }
    static async connect() { return new Sandbox(); }
    static list() { return { nextItems: async () => [] }; }
  }
  return { Sandbox, CommandExitError };
});

import { lelantos } from '../index';

describe('runCommand env handling', () => {
  beforeEach(() => {
    mockRun.mockReset();
    mockRun.mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 });
  });

  const provider = lelantos({ apiKey: 'lel_test', domain: 'lelantos.ai' });

  it('rejects environment variable names that are not POSIX shell identifiers', async () => {
    const sandbox = await provider.sandbox.create();
    await expect(
      sandbox.runCommand('echo hi', { env: { 'FOO; rm -rf /': 'x' } })
    ).rejects.toThrow(/Invalid environment variable name/);
    // The injection must be caught BEFORE any command reaches the sandbox.
    expect(mockRun).not.toHaveBeenCalled();
  });

  it('prefixes valid environment variables and escapes their values', async () => {
    const sandbox = await provider.sandbox.create();
    await sandbox.runCommand('echo hi', { env: { TOKEN: 'a"b$c`d' } });
    expect(mockRun).toHaveBeenCalledTimes(1);
    const builtCommand = mockRun.mock.calls[0][0] as string;
    // Name interpolated raw (validated safe); value shell-escaped inside quotes.
    expect(builtCommand).toBe('TOKEN="a\\"b\\$c\\`d" echo hi');
  });
});
