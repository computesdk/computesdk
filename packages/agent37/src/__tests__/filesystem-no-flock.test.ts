import { execFile } from 'node:child_process';
import { chmod, link, lstat, mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { agent37 } from '../index';

const execute = promisify(execFile);

describe('Agent37 custom images without flock (local shell, mocked transport)', () => {
  let directory: string;
  let env: NodeJS.ProcessEnv;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'agent37-no-flock-'));
    const bin = join(directory, 'bin');
    await mkdir(bin);
    for (const name of ['mkdir', 'dirname', 'base64', 'cat', 'rm', 'stat', 'dd']) await symlink(`/usr/bin/${name}`, join(bin, name));
    env = { ...process.env, PATH: bin, TMPDIR: directory };
    vi.stubGlobal('fetch', vi.fn(async (url: string, options: RequestInit) => {
      if (url.endsWith('/v1/instances')) return new Response(JSON.stringify({ id: 'without-flock', status: 'running' }));
      if (!url.endsWith('/exec')) throw new Error(`Unexpected request: ${url}`);
      const body = String(options.body);
      if (Buffer.byteLength(body) > 128_000) return new Response('request too large', { status: 413 });
      const { command } = JSON.parse(body) as { command: string };
      try {
        const result = await execute('/bin/sh', ['-c', command], { env });
        return new Response(JSON.stringify({ exit_code: 0, ...result }));
      } catch (error) {
        const result = error as { code: number; stdout: string; stderr: string };
        return new Response(JSON.stringify({ exit_code: result.code, stdout: result.stdout, stderr: result.stderr }));
      }
    }));
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    await rm(directory, { recursive: true, force: true });
  });

  it.each([false, true])('writes with no flock when destination exists=%s, like the original write', async (existing) => {
    await expect(execute('/bin/sh', ['-c', 'command -v flock'], { env })).rejects.toThrow();
    const baseline = join(directory, 'baseline');
    await execute('/bin/sh', ['-c', 'mkdir -p "$(dirname "$1")" && printf b2xkLXdyaXRl | base64 -d > "$1"', 'sh', baseline], { env });
    expect(await readFile(baseline, 'utf8')).toBe('old-write');
    const path = join(directory, 'destination');
    if (existing) await writeFile(path, 'original');
    const sandbox = await agent37({ apiKey: 'test' }).sandbox.create();
    const content = 'x'.repeat(256 * 1024);
    let failure: unknown;
    try { await sandbox.filesystem.writeFile(path, content); } catch (error) { failure = error; }
    expect.soft(failure).toBeUndefined();
    const actual = await readFile(path, 'utf8');
    expect.soft(actual.length).toBe(content.length);
    expect(actual === content).toBe(true);
    expect((await readdir(directory)).filter((name) => name.includes('.computesdk-write-'))).toEqual([]);
  });

  it('preserves modes, inodes, symlinks, hard links, UTF-8 and empty overwrites without flock', async () => {
    const target = join(directory, 'target');
    const symlinkPath = join(directory, 'symlink "quotes" $dollar');
    const hardlinkPath = join(directory, 'hardlink');
    await writeFile(target, 'original');
    await chmod(target, 0o751);
    await symlink('target', symlinkPath);
    await link(target, hardlinkPath);
    const original = await stat(target);
    const sandbox = await agent37({ apiKey: 'test' }).sandbox.create();
    const content = 'a'.repeat(48 * 1024 - 1) + '😀漢字é\0\n'.repeat(4000);
    for (const value of [content, 'short', '']) {
      await sandbox.filesystem.writeFile(symlinkPath, value);
      for (const path of [target, symlinkPath, hardlinkPath]) {
        expect(await readFile(path, 'utf8')).toBe(value);
        expect(await sandbox.filesystem.readFile(path)).toBe(value);
        const updated = await stat(path);
        expect({ inode: updated.ino, mode: updated.mode & 0o777 }).toEqual({ inode: original.ino, mode: 0o751 });
      }
      expect((await lstat(symlinkPath)).isSymbolicLink()).toBe(true);
    }
    expect((await readdir(directory)).filter((name) => name.includes('.computesdk-write-'))).toEqual([]);
  });

  it('propagates a real lock failure without falling back or overwriting the destination', async () => {
    await writeFile(join(directory, 'bin/flock'), '#!/bin/sh\nprintf "injected lock failure" >&2\nexit 73\n', { mode: 0o755 });
    const target = join(directory, 'target');
    await writeFile(target, 'original');
    const sandbox = await agent37({ apiKey: 'test' }).sandbox.create();
    await expect(sandbox.filesystem.writeFile(target, 'replacement')).rejects.toThrow('injected lock failure');
    expect(await readFile(target, 'utf8')).toBe('original');
    expect((await readdir(directory)).filter((name) => name.includes('.computesdk-write-'))).toEqual([]);
  });

  it('propagates final-copy failures without flock and cleans remote TMPDIR', async () => {
    await rm(join(directory, 'bin/cat'));
    await writeFile(join(directory, 'bin/cat'), '#!/bin/sh\nprintf "injected copy failure" >&2\nexit 74\n', { mode: 0o755 });
    const sandbox = await agent37({ apiKey: 'test' }).sandbox.create();
    await expect(sandbox.filesystem.writeFile(join(directory, 'target'), 'replacement')).rejects.toThrow('injected copy failure');
    expect((await readdir(directory)).filter((name) => name.includes('.computesdk-write-'))).toEqual([]);
  });
});
