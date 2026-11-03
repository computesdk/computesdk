import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CommandResult } from '@computesdk/provider';
import { sprites, SpritesCommandProtocolError } from '../index';

// Exercise the real adapter. Only the HTTP boundary is replaced; the submitted
// script runs in a bounded local bash, never on a provider or paid sandbox.
let execBody: ((script: string) => string) | undefined;
const roots: string[] = [];
const stderrFiles: string[] = [];

beforeEach(() => {
  execBody = undefined;
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (new URL(url).pathname.endsWith('/exec')) {
      const script = String(init?.body);
      const stderrFile = script.match(/\/tmp\/\.computesdk-stderr-[A-Za-z0-9_]+/)?.[0];
      if (stderrFile) stderrFiles.push(stderrFile);
      if (execBody) return new Response(execBody(script));
      // Sprites feeds bash its script on stdin, unlike an exec API using -c.
      const result = spawnSync('/bin/bash', ['--noprofile', '--norc'], {
        input: script, encoding: 'utf8', timeout: 2_000,
        env: { PATH: '/usr/bin:/bin' },
      });
      if (result.error) throw result.error;
      return new Response(result.stdout + result.stderr);
    }
    return new Response(JSON.stringify({ id: 'local', name: 'local' }));
  }));
});

afterEach(() => {
  vi.unstubAllGlobals();
  for (const file of stderrFiles.splice(0)) rmSync(file, { force: true });
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

async function instance() {
  return sprites({ apiKey: 'mock-only', baseUrl: 'https://sprites.invalid/v1' }).instances.create();
}

describe('Sprites real-adapter command contract (local native boundary)', () => {
  it.each([
    ['trailing comment', "printf 'out\\n'; printf 'err\\n' >&2 # trailing comment", 'out\n', 'err\n', 0],
    ['heredoc', "cat <<'PAYLOAD'\nquoted \"$HOME\" `literal`\nPAYLOAD", 'quoted "$HOME" `literal`\n', '', 0],
    ['top-level exit', "printf 'out\\n'; printf 'err\\n' >&2; exit 3", 'out\n', 'err\n', 3],
    ['trailing ampersand', 'true &', '', '', 0],
    ['exact output bytes', "printf 'out\\n\\n'; printf 'err\\n\\n' >&2", 'out\n\n', 'err\n\n', 0],
    ['control bytes', "printf 'out\\001\\r\\n'; printf 'err\\002\\r\\n' >&2", 'out\x01\r\n', 'err\x02\r\n', 0],
    ['quoted newlines', "printf '%s' 'line one\nline two'; printf 'err' >&2", 'line one\nline two', 'err', 0],
  ])('%s is safely framed', async (_name, command, stdout, stderr, exitCode) => {
    const result = await (await instance()).runCommand(command as string);
    expect(result).toMatchObject({ stdout, stderr, exitCode });
  });

  it.each([
    ['cat', 'cat', 0],
    ['read', 'read line', 1],
    ['stdin-reading interpreter', `"${process.execPath}" -e 'process.stdin.pipe(process.stdout)'`, 0],
  ])('%s sees EOF, not protocol source, and the exact stderr file is removed', async (_name, command, exitCode) => {
    let result: CommandResult | undefined;
    let caught: unknown;
    try { result = await (await instance()).runCommand(command as string); } catch (error) { caught = error; }
    const stderrFile = stderrFiles[stderrFiles.length - 1];
    expect(stderrFile).toBeTruthy();
    expect(existsSync(stderrFile)).toBe(false);
    expect(caught).toBeUndefined();
    expect(result).toMatchObject({ stdout: '', stderr: '', exitCode });
    expect(result?.stdout).not.toContain('__sp_ec');
    expect(result?.stdout).not.toContain('computesdk-stderr');
  });

  it('quotes cwd and exports literal env for the entire command list', async () => {
    const root = mkdtempSync(join(tmpdir(), 'sprites-contract-'));
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

  it.each(['missing', 'malformed', 'out-of-range', 'fractional', 'numeric-prefix', 'missing-stderr'])(
    'rejects %s completion without inventing a child exit status or leaking output',
    async (kind) => {
      execBody = (script) => {
        const exit = script.match(/__COMPUTESDK_EXIT_[A-Za-z0-9_]+__/)?.[0];
        const stderr = script.match(/__COMPUTESDK_STDERR_[A-Za-z0-9_]+__/)?.[0];
        expect(exit).toBeTruthy();
        expect(stderr).toBeTruthy();
        if (kind === 'missing') return 'secret-output-without-completion';
        if (kind === 'missing-stderr') return `secret-output${exit}0\n`;
        const statuses: Record<string, string> = {
          malformed: 'no-status', 'out-of-range': '999', fractional: '3.5', 'numeric-prefix': '0trailing',
        };
        const status = statuses[kind];
        return `secret-output${exit}${status}\n${stderr}\n`;
      };
      let caught: unknown;
      try { await (await instance()).runCommand('true'); } catch (error) { caught = error; }
      expect(caught).toBeInstanceOf(SpritesCommandProtocolError);
      expect(caught).toMatchObject({ code: 'SPRITES_COMMAND_PROTOCOL_ERROR', provider: 'sprites' });
      expect(String(caught)).not.toContain('secret-output');
      expect(JSON.stringify(caught)).not.toContain('secret-output');
    },
  );
});
