import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Readable } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { exec } = vi.hoisted(() => ({ exec: vi.fn() }));

vi.mock('modal', () => ({
  ModalClient: class {
    sandboxes = { fromId: async () => ({ sandboxId: 'sb-test', exec }) };
  },
  NotFoundError: class extends Error {},
  SandboxFilesystemNotFoundError: class extends Error {},
}));

import { modal } from '../index';

async function readText(stream: Readable): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8');
}

// Use real shell commands behind the vendor SDK boundary so the assertions
// cover the public command result, including shell syntax and pipe backpressure.
function localExec(command: string[]) {
  const child = spawn(command[0], command.slice(1), { stdio: ['ignore', 'pipe', 'pipe'] });
  const completion = new Promise<number>((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', code => resolve(code ?? 128));
  });
  return {
    stdout: { readText: () => readText(child.stdout) },
    stderr: { readText: () => readText(child.stderr) },
    wait: () => completion,
  };
}

async function sandbox() {
  const instance = await modal({ tokenId: 'test', tokenSecret: 'test' }).sandbox.getById('sb-test');
  if (!instance) throw new Error('Test sandbox not found');
  return instance;
}

describe('modal runCommand', () => {
  let directory: string;

  beforeEach(async () => {
    exec.mockReset().mockImplementation(localExec);
    directory = await mkdtemp(join(tmpdir(), 'modal command '));
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it('returns both output streams and the command exit code without trimming', async () => {
    const result = await (await sandbox()).runCommand("printf '  hello🌍\\n'; printf ' error🌍\\n' >&2; exit 7");
    expect(result).toMatchObject({ stdout: '  hello🌍\n', stderr: ' error🌍\n', exitCode: 7 });
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('drains output larger than both pipe buffers', async () => {
    const size = 1024 * 1024;
    const script = `const fs = require('fs'); fs.writeSync(1, 'x'.repeat(${size})); fs.writeSync(2, 'e'.repeat(${size})); fs.writeSync(1, '🌍');`;
    const quote = (value: string) => `'${value.replace(/'/g, `'\\''`)}'`;
    const command = `${quote(process.execPath)} -e ${quote(script)}`;
    const result = await (await sandbox()).runCommand(command);
    expect(result).toMatchObject({ stdout: 'x'.repeat(size) + '🌍', stderr: 'e'.repeat(size), exitCode: 0 });
  });

  it('includes output that arrives after the exit status', async () => {
    exec.mockResolvedValueOnce({
      stdout: { readText: () => new Promise(resolve => setTimeout(() => resolve('final stdout'), 10)) },
      stderr: { readText: () => new Promise(resolve => setTimeout(() => resolve('final stderr'), 20)) },
      wait: async () => 23,
    });
    expect(await (await sandbox()).runCommand('command')).toMatchObject({
      stdout: 'final stdout', stderr: 'final stderr', exitCode: 23,
    });
  });

  it('accepts empty output, heredocs and trailing comments', async () => {
    const instance = await sandbox();
    expect(await instance.runCommand('true')).toMatchObject({ stdout: '', stderr: '', exitCode: 0 });
    expect(await instance.runCommand("cat <<'EOF'\nhello\nEOF\n# trailing comment")).toMatchObject({
      stdout: 'hello\n', stderr: '', exitCode: 0,
    });
  });

  it('preserves cwd and environment variables across compound commands', async () => {
    const value = 'spaces "quotes" $HOME `false`';
    const result = await (await sandbox()).runCommand('pwd; printf "%s" "$VALUE"; printf "%s" "$VALUE" >&2', {
      cwd: directory, env: { VALUE: value },
    });
    expect(result).toMatchObject({ stdout: `${directory}\n${value}`, stderr: value, exitCode: 0 });
  });

  it('starts background commands with their cwd and environment', async () => {
    const result = await (await sandbox()).runCommand('sleep 0.1; printf "%s" "$VALUE" > done', {
      cwd: directory, env: { VALUE: 'background' }, background: true,
    });
    expect(result).toMatchObject({ stdout: '', stderr: '', exitCode: 0 });
    await vi.waitFor(async () => expect(await readFile(join(directory, 'done'), 'utf8')).toBe('background'));
  });

  it('reports SDK timeouts as failed command results', async () => {
    exec.mockRejectedValueOnce(new Error('Timeout expired'));
    expect(await (await sandbox()).runCommand('sleep 10', { timeout: 10 })).toMatchObject({
      stdout: '', stderr: 'Timeout expired', exitCode: 127,
    });
  });

  it('reports stream failures instead of returning a successful truncated result', async () => {
    exec.mockResolvedValueOnce({
      stdout: { readText: async () => { throw new Error('Stream disconnected'); } },
      stderr: { readText: async () => '' },
      wait: async () => 0,
    });
    expect(await (await sandbox()).runCommand('command')).toMatchObject({
      stdout: '', stderr: 'Stream disconnected', exitCode: 127,
    });
  });
});
