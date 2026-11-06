import { execFile } from 'node:child_process';
import { chmod, link, lstat, mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { agent37 } from '../index';

const execute = promisify(execFile);
const instance = { id: 'filesystem-test', status: 'running', template: 'agent37-base', type: 'default', region: 'us', resources: { cpu: 2, memory: 4, disk: 4 }, url: 'https://test.invalid', created: 0 };

describe('Agent37 filesystem exec transfers (local shell, mocked transport)', () => {
  let directory: string;
  let bodies: string[];
  let intercept: ((command: string) => Response | undefined | Promise<Response | undefined>) | undefined;
  let guest: { uid?: number; gid?: number };
  let stagingDirectory: string;
  let readOnlyDirectory: string | undefined;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'agent37-filesystem-'));
    bodies = [];
    intercept = undefined;
    guest = {};
    readOnlyDirectory = undefined;
    stagingDirectory = join(directory, 'remote temp "quotes" $dollar');
    await mkdir(stagingDirectory);
    vi.stubGlobal('fetch', vi.fn(async (url: string, options: RequestInit) => {
      if (url.endsWith('/v1/instances')) return new Response(JSON.stringify(instance), { status: 201 });
      if (!url.endsWith('/exec')) throw new Error(`Unexpected request: ${url}`);
      const body = String(options.body);
      bodies.push(body);
      if (Buffer.byteLength(body) > 128_000) return new Response('The request body must be at most 128 KB.', { status: 413 });
      const { command } = JSON.parse(body) as { command: string };
      const failure = await intercept?.(command);
      if (failure) return failure;
      try {
        const { stdout, stderr } = await execute('/bin/sh', ['-c', command], { ...guest, env: { ...process.env, TMPDIR: stagingDirectory }, cwd: directory, maxBuffer: 2 * 1024 * 1024 });
        return new Response(JSON.stringify({ exit_code: 0, stdout: stdout.slice(0, 512_000), stderr, truncated: stdout.length > 512_000 }));
      } catch (error) {
        const result = error as { code: number; stdout: string; stderr: string };
        return new Response(JSON.stringify({ exit_code: result.code, stdout: result.stdout, stderr: result.stderr }));
      }
    }));
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    if (readOnlyDirectory) await chmod(readOnlyDirectory, 0o755);
    await rm(directory, { recursive: true, force: true });
  });

  async function sandbox() {
    return agent37({ apiKey: 'test' }).sandbox.create();
  }

  async function expectNoStagingFiles() {
    expect((await readdir(directory, { recursive: true })).filter((name) => name.includes('.computesdk-write-'))).toEqual([]);
  }

  async function originalWrite(path: string, content: string) {
    await execute('/bin/sh', ['-c', 'mkdir -p "$(dirname "$1")" && printf "%s" "$2" | base64 -d > "$1"', 'sh', path, Buffer.from(content).toString('base64')], guest);
  }

  it('overwrites a writable file in a read-only directory as a non-root guest like the original write', async () => {
    if (process.getuid?.() === 0) guest = { uid: 65534, gid: 65534 };
    await chmod(directory, 0o755);
    await chmod(stagingDirectory, 0o777);
    readOnlyDirectory = join(directory, 'read-only-dir');
    await mkdir(readOnlyDirectory);
    const path = join(readOnlyDirectory, 'writable-file');
    await writeFile(path, 'original');
    await chmod(path, 0o666);
    await chmod(readOnlyDirectory, 0o555);
    const identity = await execute('/bin/sh', ['-c', 'id -u'], guest);
    expect(identity.stdout.trim()).not.toBe('0');
    await expect(execute('/bin/sh', ['-c', ': > "$1"', 'sh', join(readOnlyDirectory, 'cannot-create')], guest)).rejects.toThrow();
    await originalWrite(path, 'old-write');
    expect(await readFile(path, 'utf8')).toBe('old-write');
    const sb = await sandbox();
    const content = 'x'.repeat(256 * 1024);
    await sb.filesystem.writeFile(path, content);
    expect(await readFile(path, 'utf8')).toBe(content);
    expect((await stat(path)).mode & 0o777).toBe(0o666);
    await expectNoStagingFiles();
  });

  it('writes the fidelity 256 KiB deterministic text concurrently with three small files and reads exact contents', async () => {
    const sb = await sandbox();
    const files = [
      ['payload.txt', 'fidelity-content-test'],
      ['large.bin', 'x'.repeat(256 * 1024)],
      ['mutated-target.txt', 'delete-me-test'],
      ['run.sh', '#!/bin/sh\necho exec-ok-test\n'],
    ];
    await Promise.all(files.map(([name, content]) => sb.filesystem.writeFile(join(directory, name), content)));
    for (const [name, content] of files) {
      expect(await readFile(join(directory, name), 'utf8')).toBe(content);
      expect(await sb.filesystem.readFile(join(directory, name))).toBe(content);
    }
    expect(Math.max(...bodies.map((body) => Buffer.byteLength(body)))).toBeLessThan(128_000);
    expect(bodies.filter((body) => JSON.parse(body).command.includes('base64 -d >>'))).toHaveLength(9);
    await expectNoStagingFiles();
  });

  it('stages privately in the remote TMPDIR, not beside the destination', async () => {
    const sb = await sandbox();
    let checked = false;
    intercept = async (command) => {
      if (command.includes('base64 -d >>')) {
        const files = await readdir(stagingDirectory);
        expect(files).toHaveLength(1);
        expect(files[0]).toMatch(/^\.computesdk-write-/);
        expect((await stat(join(stagingDirectory, files[0]))).mode & 0o777).toBe(0o600);
        checked = true;
      }
      return undefined;
    };
    await sb.filesystem.writeFile(join(directory, 'destination'), 'private staging');
    expect(checked).toBe(true);
    expect(await readdir(stagingDirectory)).toEqual([]);
  });

  it.each([1, 48 * 1024 - 1, 48 * 1024, 48 * 1024 + 1, 96 * 1024])('writes %i bytes across chunk boundaries', async (length) => {
    const sb = await sandbox();
    const content = 'a'.repeat(length);
    const path = join(directory, 'boundary');
    await sb.filesystem.writeFile(path, content);
    expect(await readFile(path, 'utf8')).toBe(content);
  });

  it('preserves UTF-8 split across chunks, NUL bytes, and shell metacharacters in content', async () => {
    const sb = await sandbox();
    const content = 'a'.repeat(48 * 1024 - 1) + '😀漢字é\0\n$HOME `id` "quotes" \'single\'\\'.repeat(3000);
    const path = join(directory, 'unicode');
    await sb.filesystem.writeFile(path, content);
    expect(await readFile(path)).toEqual(Buffer.from(content, 'utf8'));
    expect(await sb.filesystem.readFile(path)).toBe(content);
  });

  it('creates parents, overwrites without trailing bytes, and creates or truncates empty files', async () => {
    const sb = await sandbox();
    const path = join(directory, 'nested', 'file');
    await sb.filesystem.writeFile(path, 'x'.repeat(256 * 1024));
    await sb.filesystem.writeFile(path, 'short');
    expect(await readFile(path, 'utf8')).toBe('short');
    await sb.filesystem.writeFile(path, '');
    expect(await readFile(path, 'utf8')).toBe('');
    await sb.filesystem.writeFile(join(directory, 'empty'), '');
    expect(await readFile(join(directory, 'empty'), 'utf8')).toBe('');
    await expectNoStagingFiles();
  });

  it('quotes unusual paths and accepts relative paths with a leading dash', async () => {
    const sb = await sandbox();
    const path = join(directory, 'dir "\'\\$HOME`touch injected`\n', 'file $(touch injected)');
    await sb.filesystem.writeFile(path, 'safe');
    expect(await readFile(path, 'utf8')).toBe('safe');
    await sb.filesystem.writeFile('-leading-dash', 'relative');
    expect(await readFile(join(directory, '-leading-dash'), 'utf8')).toBe('relative');
    expect(await readdir(directory)).not.toContain('injected');
  });

  it('publishes one complete file when concurrent transfers target the same path', async () => {
    const sb = await sandbox();
    const path = join(directory, 'shared');
    const contents = ['a'.repeat(256 * 1024), 'b'.repeat(200 * 1024)];
    await Promise.all(contents.map((content) => sb.filesystem.writeFile(path, content)));
    expect(contents).toContain(await readFile(path, 'utf8'));
    await expectNoStagingFiles();
  });

  it('preserves an existing executable file inode and mode like the original redirection', async () => {
    const sb = await sandbox();
    const path = join(directory, 'executable');
    await writeFile(path, '#!/bin/sh\necho original\n');
    await chmod(path, 0o751);
    const original = await stat(path);
    await originalWrite(path, 'old-write');
    const updated = await stat(path);
    expect({ inode: updated.ino, mode: updated.mode & 0o777 }).toEqual({ inode: original.ino, mode: 0o751 });
    await sb.filesystem.writeFile(path, '#!/bin/sh\necho updated\n');
    expect.soft((await stat(path)).mode & 0o777).toBe(0o751);
    expect.soft((await stat(path)).ino).toBe(original.ino);
    expect(await readFile(path, 'utf8')).toBe('#!/bin/sh\necho updated\n');
  });

  it('follows a symlink without replacing it like the original redirection', async () => {
    const sb = await sandbox();
    const target = join(directory, 'target');
    const link = join(directory, 'link');
    await writeFile(target, 'original');
    await symlink('target', link);
    await originalWrite(link, 'old-write');
    expect((await lstat(link)).isSymbolicLink()).toBe(true);
    expect(await readFile(target, 'utf8')).toBe('old-write');
    await sb.filesystem.writeFile(link, 'updated');
    expect((await lstat(link)).isSymbolicLink()).toBe(true);
    expect(await readFile(target, 'utf8')).toBe('updated');
  });

  it('follows dangling symlinks and preserves the target mode and inode on empty overwrites', async () => {
    const sb = await sandbox();
    const target = join(directory, 'target');
    const symlinkPath = join(directory, 'dangling');
    await symlink('target', symlinkPath);
    await sb.filesystem.writeFile(symlinkPath, 'created through symlink');
    expect((await lstat(symlinkPath)).isSymbolicLink()).toBe(true);
    expect(await readFile(target, 'utf8')).toBe('created through symlink');
    await chmod(target, 0o751);
    const original = await stat(target);
    await sb.filesystem.writeFile(symlinkPath, '');
    expect(await readFile(target, 'utf8')).toBe('');
    expect((await stat(target)).ino).toBe(original.ino);
    expect((await stat(target)).mode & 0o777).toBe(0o751);
    expect((await lstat(symlinkPath)).isSymbolicLink()).toBe(true);
  });

  it('serializes concurrent writes through a path, its symlink and its hard link', async () => {
    const sb = await sandbox();
    const target = join(directory, 'target');
    const symlinkPath = join(directory, 'symlink');
    const hardlinkPath = join(directory, 'hardlink');
    await writeFile(target, 'original');
    await symlink('target', symlinkPath);
    await link(target, hardlinkPath);
    const original = await stat(target);
    const paths = [target, symlinkPath, hardlinkPath];
    const contents = ['a'.repeat(256 * 1024), 'b'.repeat(220 * 1024), 'c'.repeat(200 * 1024)];
    await Promise.all(paths.map((path, index) => sb.filesystem.writeFile(path, contents[index])));
    const actual = await readFile(target, 'utf8');
    expect(contents).toContain(actual);
    for (const path of paths) {
      expect(await readFile(path, 'utf8')).toBe(actual);
      expect((await stat(path)).ino).toBe(original.ino);
    }
    expect((await lstat(symlinkPath)).isSymbolicLink()).toBe(true);
    await expectNoStagingFiles();
  });

  it.each(['chunk', 'commit', 'transport'] as const)('propagates %s failures, preserves the destination, and cleans staging files', async (failure) => {
    const sb = await sandbox();
    const path = join(directory, 'existing');
    await writeFile(path, 'original');
    let chunks = 0;
    intercept = (command) => {
      const chunk = command.includes('base64 -d >>') && ++chunks === 2;
      if ((failure === 'commit' && command.startsWith('(flock ')) || (failure !== 'commit' && chunk)) {
        if (failure === 'transport') return new Response('injected API failure', { status: 503 });
        return new Response(JSON.stringify({ exit_code: 1, stdout: '', stderr: 'injected shell failure' }));
      }
    };
    await expect(sb.filesystem.writeFile(path, 'x'.repeat(256 * 1024))).rejects.toThrow(failure === 'transport' ? 'injected API failure' : 'injected shell failure');
    expect(await readFile(path, 'utf8')).toBe('original');
    await expectNoStagingFiles();
  });

  it('does not mask a write error if cleanup also fails', async () => {
    const sb = await sandbox();
    intercept = (command) => {
      if (command.startsWith('rm ')) throw new Error('cleanup failed');
      if (command.includes('base64 -d >>')) throw new Error('write failed');
      return undefined;
    };
    await expect(sb.filesystem.writeFile(join(directory, 'failed'), 'content')).rejects.toThrow('write failed');
  });

  it('rejects writing over a directory without leaving staging files', async () => {
    const sb = await sandbox();
    await expect(sb.filesystem.writeFile(directory, 'content')).rejects.toThrow('Failed to write');
    await expectNoStagingFiles();
  });

  it('rejects truncated read output rather than returning corrupted text', async () => {
    const sb = await sandbox();
    const path = join(directory, 'too-large');
    await sb.filesystem.writeFile(path, 'x'.repeat(400 * 1024));
    await expect(sb.filesystem.readFile(path)).rejects.toThrow('larger than one command\'s output limit');
  });
});
