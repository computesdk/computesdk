import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const native = vi.hoisted(() => ({ executeCommand: vi.fn() }));
vi.mock('@daytonaio/sdk', () => ({
  Daytona: class {
    async create() { return { id: 'local', process: native }; }
  },
  DaytonaNotFoundError: class extends Error {},
}));
import { daytona, DaytonaCommandProtocolError } from '../index';

const roots: string[] = [];
const stderrFiles: string[] = [];

async function instance() {
  return daytona({ apiKey: 'mock-only' }).instances.create();
}

// Native Daytona selects zsh/bash/sh. zsh is not installed locally; exercise
// both available shell families without installing anything or calling Daytona.
describe.each(['/bin/bash', '/bin/sh'])('Daytona real-adapter command contract (%s native boundary)', (shell) => {
  beforeEach(() => {
    native.executeCommand.mockReset();
    // Model the native shell-string/cwd/env API, not provider implementation.
    // Unlike Sprites, the shell command is not supplied as stdin script source.
    native.executeCommand.mockImplementation(async (command: string, cwd?: string, env?: Record<string, string>) => {
      const stderrFile = command.match(/\/tmp\/\.computesdk-stderr-[A-Za-z0-9-]+/)?.[0];
      if (stderrFile) stderrFiles.push(stderrFile);
      const args = shell === '/bin/bash' ? ['--noprofile', '--norc', '-c', command] : ['-c', command];
      const result = spawnSync(shell, args, {
        input: '', encoding: 'utf8', timeout: 2_000, cwd,
        env: { PATH: '/usr/bin:/bin', ...env },
      });
      if (result.error) throw result.error;
      return { result: result.stdout + result.stderr, exitCode: result.status };
    });
  });
  afterEach(() => {
    const files = stderrFiles.splice(0);
    const leftovers = files.filter((file) => existsSync(file));
    for (const file of files) rmSync(file, { force: true });
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
    expect(leftovers).toEqual([]);
  });

  it.each([
    ['trailing comment', "printf 'out\\n'; printf 'err\\n' >&2 # trailing comment", 'out\n', 'err\n', 0],
    ['heredoc', "cat <<'PAYLOAD'\nquoted \"$HOME\" `literal`\nPAYLOAD", 'quoted "$HOME" `literal`\n', '', 0],
    ['top-level exit', "printf 'out\\n'; printf 'err\\n' >&2; exit 3", 'out\n', 'err\n', 3],
    ['trailing ampersand', 'true &', '', '', 0],
    ['exact output bytes', "printf 'out\\n\\n'; printf 'err\\n\\n' >&2", 'out\n\n', 'err\n\n', 0],
    ['control bytes', "printf 'out\\001\\r\\n'; printf 'err\\002\\r\\n' >&2", 'out\x01\r\n', 'err\x02\r\n', 0],
    ['quoted newlines', "printf '%s' 'line one\nline two'; printf 'err' >&2", 'line one\nline two', 'err', 0],
    ['stdin cat', 'cat', '', '', 0],
    ['stdin read', 'read line', '', '', 1],
    ['stdin-reading interpreter', `"${process.execPath}" -e 'process.stdin.pipe(process.stdout)'`, '', '', 0],
  ])('%s is safely framed', async (_name, command, stdout, stderr, exitCode) => {
    const result = await (await instance()).runCommand(command as string);
    expect(result).toMatchObject({ stdout, stderr, exitCode });
  });

  it('preserves native exit status and output if no completion delimiter arrives', async () => {
    native.executeCommand.mockResolvedValueOnce({ result: 'native failure\n', exitCode: 23 });
    const result = await (await instance()).runCommand('true');
    expect(result).toMatchObject({ stdout: 'native failure\n', stderr: '', exitCode: 23 });
  });

  it.each([undefined, null, 0, -1, 0.5, 256, '23', NaN, Infinity])(
    'rejects absent completion with successful or invalid native status %j',
    async (exitCode) => {
      native.executeCommand.mockResolvedValueOnce({
        result: 'secret-output-without-child-completion',
        exitCode,
      });
      const operation = (await instance()).runCommand('true');
      await expect(operation).rejects.toBeInstanceOf(DaytonaCommandProtocolError);
      await expect(operation).rejects.toMatchObject({
        code: 'DAYTONA_COMMAND_PROTOCOL_ERROR',
        provider: 'daytona',
        reason: 'missing-completion',
      });
      await expect(operation).rejects.not.toThrow('secret-output');
    },
  );

  it.each([1, 23, 255])('preserves an explicit native failure %i without a delimiter', async (exitCode) => {
    native.executeCommand.mockResolvedValueOnce({ result: 'native failure\n', exitCode });
    await expect((await instance()).runCommand('true')).resolves.toMatchObject({
      stdout: 'native failure\n', stderr: '', exitCode,
    });
  });

  it.each([
    { status: 0, nativeCode: undefined },
    { status: 0, nativeCode: null },
    { status: 0, nativeCode: 23 },
    { status: 255, nativeCode: 0 },
    { status: 3, nativeCode: 'invalid' },
  ])('trusts valid child status $status independently of native $nativeCode', async ({ status, nativeCode }) => {
    native.executeCommand.mockImplementationOnce(async (script: string) => {
      const delimiter = script.match(/__COMPUTESDK_STDERR_[A-Za-z0-9_]+__/)?.[0];
      expect(delimiter).toBeTruthy();
      return { result: `out\n${delimiter}${status}\nerr\n`, exitCode: nativeCode };
    });
    await expect((await instance()).runCommand('true')).resolves.toMatchObject({
      stdout: 'out\n', stderr: 'err\n', exitCode: status,
    });
  });

  it.each(['not-a-status\n', '0'])('rejects invalid or unterminated child status %j despite native failure', async status => {
    native.executeCommand.mockImplementationOnce(async (script: string) => {
      const delimiter = script.match(/__COMPUTESDK_STDERR_[A-Za-z0-9_]+__/)?.[0];
      expect(delimiter).toBeTruthy();
      return { result: `secret-output${delimiter}${status}`, exitCode: 23 };
    });
    await expect((await instance()).runCommand('true')).rejects.toMatchObject({
      code: 'DAYTONA_COMMAND_PROTOCOL_ERROR', reason: 'invalid-completion',
    });
  });

  it('background startup groups and redirects the entire short command list', async () => {
    // Only immediate shell builtins are launched; no long-lived child/server.
    const result = await (await instance()).runCommand(
      "printf 'first'; printf 'second' # final comment", { background: true },
    );
    expect(result).toMatchObject({ stdout: '', stderr: '', exitCode: 0 });
  });

  it('quotes cwd and preserves literal env over the entire command list', async () => {
    const root = mkdtempSync(join(tmpdir(), 'daytona-contract-'));
    roots.push(root);
    const cwd = join(root, 'space " $literal\npath');
    mkdirSync(cwd);
    const value = 'a "quote" $HOME `literal` \\ slash\nsecond line';
    const result = await (await instance()).runCommand(
      'printf \'%s\\n\' "$PAYLOAD"; printf \'%s\\n\' "$PAYLOAD"; pwd',
      { cwd, env: { PAYLOAD: value } },
    );
    expect(result).toMatchObject({ stdout: `${value}\n${value}\n${cwd}\n`, stderr: '', exitCode: 0 });
  });

  it('preserves stderr even when the command overrides PATH', async () => {
    const result = await (await instance()).runCommand(
      "printf 'out'; printf 'err' >&2", { env: { PATH: '/nonexistent' } },
    );
    expect(result).toMatchObject({ stdout: 'out', stderr: 'err', exitCode: 0 });
  });

  it.each(['not-a-status', '-1', '999', '3.5', '0trailing', ''])(
    'rejects malformed completion status %j without inventing zero or leaking output',
    async (status) => {
      native.executeCommand.mockImplementationOnce(async (script: string) => {
        const delimiter = script.match(/__COMPUTESDK_STDERR_[A-Za-z0-9_]+__/)?.[0];
        expect(delimiter).toBeTruthy();
        return { result: `secret-output${delimiter}${status}\nsecret-stderr`, exitCode: 0 };
      });
      let caught: unknown;
      try { await (await instance()).runCommand('true'); } catch (error) { caught = error; }
      expect(caught).toBeInstanceOf(DaytonaCommandProtocolError);
      expect(caught).toMatchObject({
        code: 'DAYTONA_COMMAND_PROTOCOL_ERROR', provider: 'daytona', reason: 'invalid-completion',
      });
      expect(String(caught)).toContain('Daytona command completion status is invalid');
      expect(String(caught)).not.toContain('secret-output');
      expect(String(caught)).not.toContain('secret-stderr');
      expect(JSON.stringify(caught)).not.toContain('secret-output');
      expect(JSON.stringify(caught)).not.toContain('secret-stderr');
    },
  );

  it('retains native timeout conversion and meaningful native errors', async () => {
    native.executeCommand.mockRejectedValueOnce(new Error('native transport unavailable'));
    await expect((await instance()).runCommand('true', { timeout: 1_501 }))
      .rejects.toThrow('native transport unavailable');
    expect(native.executeCommand.mock.calls[0][3]).toBe(2);
  });
});
