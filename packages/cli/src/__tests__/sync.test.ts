import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { tmpdir } from 'node:os';
import { createServer, type Server } from 'node:http';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import * as tar from 'tar';
import { syncEndpoint, syncOnce, sourceFilter, printSync } from '../sync.js';
import { localTree } from '../sync-fs.js';
import type { ActionsClient } from '../actions-client.js';
const shell = promisify(exec);
const id = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
const id2 = 'b1b2c3d4-e5f6-7890-abcd-ef1234567890';
let dir: string;
let source: string;
let destination: string;
let c: ActionsClient;
let server: Server;
let origin: string;
const post = vi.fn();
const transfers = new Map<string, { path: string; file: string }>();
let uploaded = Buffer.alloc(0);
beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(tmpdir(), 'compute-sync-test-'));
  source = path.join(dir, 'source'); destination = path.join(dir, 'destination');
  fs.mkdirSync(source); fs.mkdirSync(destination);
  transfers.clear(); post.mockReset(); uploaded = Buffer.alloc(0);
  server = createServer(async (req, res) => {
    if (req.method === 'PUT') {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      uploaded = Buffer.concat(chunks);
      res.end();
    } else {
      res.end(fs.readFileSync(path.join(dir, 'download.tar.gz')));
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  post.mockImplementation(async (url: string, body: Record<string, unknown>) => {
    if (url.endsWith('/commands')) {
      try {
        const result = await shell(body.command as string, { maxBuffer: 16 * 1024 * 1024 });
        return { ...result, exitCode: 0 };
      } catch (error) {
        const e = error as { stdout: string; stderr: string; code: number };
        return { stdout: e.stdout, stderr: e.stderr, exitCode: e.code };
      }
    }
    if (url.endsWith('/transfers')) {
      if (body.direction === 'download') {
        await tar.create({ file: path.join(dir, 'download.tar.gz'), gzip: true, cwd: path.dirname(body.path as string) }, [path.basename(body.path as string)]);
        return { downloadUrl: origin + '/download' };
      }
      const transferId = String(transfers.size);
      transfers.set(transferId, { path: body.path as string, file: path.join(dir, 'uploaded.tar.gz') });
      return { transferId, uploadUrl: origin + '/upload' };
    }
    if (url.endsWith('/complete')) {
      const transfer = transfers.get(url.split('/').at(-2)!)!;
      fs.writeFileSync(transfer.file, uploaded);
      await tar.extract({ file: transfer.file, cwd: transfer.path });
      return {};
    }
    throw new Error('Unexpected ' + url);
  });
  c = { post } as unknown as ActionsClient;
});
afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  fs.rmSync(dir, { recursive: true, force: true });
  vi.unstubAllEnvs();
});
const write = (root: string, relative: string, content: string | Buffer) => {
  const file = path.join(root, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, content);
};

describe('one-way project sync', () => {
  it('uploads contents, ignores nested rules, and preserves binaries, links and executable bits', async () => {
    write(source, '.gitignore', 'node_modules/\n*.secret\n');
    write(source, 'node_modules/pkg/index.js', 'excluded');
    write(source, 'file.secret', 'excluded');
    write(source, 'src/.gitignore', '*.log\n!keep.log\n');
    write(source, 'src/drop.log', 'excluded'); write(source, 'src/keep.log', 'included');
    write(source, '.git/config', 'never');
    write(source, 'data.bin', Buffer.from([0, 255, 128, 13]));
    write(source, 'run.sh', '#!/bin/sh\necho hello\n'); fs.chmodSync(path.join(source, 'run.sh'), 0o755);
    fs.symlinkSync('run.sh', path.join(source, 'run-link'));
    const target = { id, remote: destination };
    const result = await syncOnce(c, { local: source }, target, {});
    expect(result.copy.map((e) => e.path)).not.toEqual(expect.arrayContaining(['node_modules', 'file.secret', '.git', 'src/drop.log']));
    expect(fs.readFileSync(path.join(destination, 'data.bin'))).toEqual(Buffer.from([0, 255, 128, 13]));
    expect(fs.statSync(path.join(destination, 'run.sh')).mode & 0o777).toBe(0o755);
    expect(fs.readlinkSync(path.join(destination, 'run-link'))).toBe('run.sh');
    expect(fs.existsSync(path.join(destination, 'src/keep.log'))).toBe(true);
    const before = transfers.size;
    expect(await syncOnce(c, { local: source }, target, {})).toEqual({ copy: [], remove: [] });
    expect(transfers.size).toBe(before);
    write(source, 'data.bin', 'changed');
    expect((await syncOnce(c, { local: source }, target, {})).copy.map((e) => e.path)).toEqual(['data.bin']);
  });

  it('dry-run plans copies and deletes without transfers or filesystem mutations', async () => {
    write(source, 'new.txt', 'new'); write(destination, 'old.txt', 'old');
    const before = await localTree({ root: destination });
    const plan = await syncOnce(c, { local: source }, { id, remote: destination }, { dryRun: true, delete: true });
    expect(plan.copy.map((e) => e.path)).toEqual(['new.txt']);
    expect(plan.remove.map((e) => e.path)).toEqual(['old.txt']);
    expect(await localTree({ root: destination })).toEqual(before);
    expect(post.mock.calls.every(([url]) => url.endsWith('/commands'))).toBe(true);
  });

  it('preserves destination-only files by default and ignored paths even with --delete', async () => {
    write(source, '.gitignore', 'cache/\n'); write(source, 'current', 'new');
    write(source, 'cache/.gitignore', '!keep\n');
    write(destination, 'stale/sub/file', 'old'); write(destination, 'cache/keep', 'important');
    write(destination, '.git/config', 'important');
    await syncOnce(c, { local: source }, { id, remote: destination }, {});
    expect(fs.existsSync(path.join(destination, 'stale/sub/file'))).toBe(true);
    await syncOnce(c, { local: source }, { id, remote: destination }, { delete: true });
    expect(fs.existsSync(path.join(destination, 'stale'))).toBe(false);
    expect(fs.readFileSync(path.join(destination, 'cache/keep'), 'utf8')).toBe('important');
    expect(fs.readFileSync(path.join(destination, '.git/config'), 'utf8')).toBe('important');
  });

  it('downloads into the destination directly, replacing changed files without touching extras', async () => {
    write(source, 'nested/data', Buffer.from([255, 0, 3]));
    write(source, '.git/config', 'excluded');
    fs.symlinkSync('/etc', path.join(source, '.git/hooks'));
    write(destination, 'nested/data', 'old'); write(destination, 'keep', 'keep');
    await syncOnce(c, { id, remote: source }, { local: destination }, {});
    expect(fs.readFileSync(path.join(destination, 'nested/data'))).toEqual(Buffer.from([255, 0, 3]));
    expect(fs.existsSync(path.join(destination, 'source'))).toBe(false);
    expect(fs.readFileSync(path.join(destination, 'keep'), 'utf8')).toBe('keep');
  });

  it('relays sandbox-to-sandbox and can create a missing destination directory', async () => {
    write(source, 'file', 'remote source');
    const target = path.join(destination, 'new-project');
    await syncOnce(c, { id, remote: source }, { id: id2, remote: target }, {});
    expect(fs.readFileSync(path.join(target, 'file'), 'utf8')).toBe('remote source');
    expect(post.mock.calls.filter(([url]) => url.includes('/transfers')).map(([url]) => url)).toEqual([
      `/api/v1/sandboxes/${id}/transfers`, `/api/v1/sandboxes/${id2}/transfers`, `/api/v1/sandboxes/${id2}/transfers/0/complete`,
    ]);
  });

  it('rejects overlapping paths, directory/file conflicts, and unsafe symlinks before modifying anything', async () => {
    await expect(syncOnce(c, { id, remote: source }, { id, remote: source + '/nested' }, {})).rejects.toThrow('overlap');
    write(source, 'same', 'file'); fs.mkdirSync(path.join(destination, 'same'));
    await expect(syncOnce(c, { local: source }, { id, remote: destination }, { delete: true })).rejects.toThrow('type conflict');
    fs.symlinkSync('/etc/passwd', path.join(source, 'escape'));
    await expect(syncOnce(c, { local: source }, { id, remote: destination }, {})).rejects.toThrow('outside sync root');
    expect(transfers.size).toBe(0);
  });

  it('never deletes destination files after upload failure', async () => {
    write(source, 'file', 'new'); write(destination, 'keep', 'old');
    const original = post.getMockImplementation()!;
    post.mockImplementation(async (url, body) => {
      if (url.endsWith('/complete')) throw new Error('transfer failed');
      return original(url, body);
    });
    await expect(syncOnce(c, { local: source }, { id, remote: destination }, { delete: true })).rejects.toThrow('transfer failed');
    expect(fs.readFileSync(path.join(destination, 'keep'), 'utf8')).toBe('old');
  });

  it('does not delete a destination file edited while the upload was in progress', async () => {
    write(source, 'file', 'new'); write(destination, 'keep', 'old');
    const original = post.getMockImplementation()!;
    post.mockImplementation(async (url, body) => {
      const response = await original(url, body);
      if (url.endsWith('/complete')) write(destination, 'keep', 'edited concurrently');
      return response;
    });
    await expect(syncOnce(c, { local: source }, { id, remote: destination }, { delete: true })).rejects.toThrow('changed before deletion');
    expect(fs.readFileSync(path.join(destination, 'keep'), 'utf8')).toBe('edited concurrently');
  });

  it('refuses destination symlink traversal and filesystem roots', async () => {
    fs.symlinkSync(source, path.join(destination, 'linked'));
    await expect(syncOnce(c, { id, remote: source }, { local: path.join(destination, 'linked/child') }, {})).rejects.toThrow('symlink');
    await expect(localTree({ root: '/' })).rejects.toThrow('filesystem root');
  });

  it('respects ignore rules from the repository root when syncing a subdirectory', async () => {
    await shell(`git init '${source}'`);
    write(source, '.gitignore', '*.secret\n');
    write(source, 'sub/app.js', 'code'); write(source, 'sub/key.secret', 'secret');
    const sub = path.join(source, 'sub');
    expect((await localTree({ root: sub }, sourceFilter(sub))).map((e) => e.path)).toEqual(['app.js']);
  });

  it('preserves a destination directory containing nested .git data during deletion', async () => {
    write(destination, 'nested/.git/config', 'preserve');
    write(destination, 'nested/stale', 'delete');
    await syncOnce(c, { local: source }, { id, remote: destination }, { delete: true });
    expect(fs.readFileSync(path.join(destination, 'nested/.git/config'), 'utf8')).toBe('preserve');
    expect(fs.existsSync(path.join(destination, 'nested/stale'))).toBe(false);
  });

  it('creates an empty destination even when the source has no entries', async () => {
    const target = path.join(destination, 'empty');
    await syncOnce(c, { local: source }, { id, remote: target }, {});
    expect(fs.statSync(target).isDirectory()).toBe(true);
  });

  it('rejects a malicious download archive before writing to the destination', async () => {
    write(source, 'file', 'valid');
    const original = post.getMockImplementation()!;
    post.mockImplementation(async (url, body) => {
      const response = await original(url, body);
      if (url.endsWith('/transfers') && body.direction === 'download') {
        fs.symlinkSync('/etc', path.join(source, 'bad-link'));
        await tar.create({ file: path.join(dir, 'download.tar.gz'), gzip: true, cwd: path.dirname(source) }, [path.basename(source)]);
      }
      return response;
    });
    await expect(syncOnce(c, { id, remote: source }, { local: destination }, {})).rejects.toThrow('Unsafe symlink');
    expect(fs.readdirSync(destination)).toEqual([]);
  });

  it('prints each JSON sync result on one line for watch consumers', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      printSync({ copy: [{ path: 'file', type: 'file', mode: 0o644 }], remove: [] }, { json: true, watch: true });
      expect(log.mock.calls).toHaveLength(1);
      const line = log.mock.calls[0][0];
      expect(line).not.toContain('\n');
      expect(JSON.parse(line)).toEqual({ dryRun: false, copied: ['file'], deleted: [] });
    } finally { log.mockRestore(); }
  });

  it('uses explicit IDs or the selected sandbox, and does not treat absolute local paths as remote', () => {
    vi.stubEnv('COMPUTE_INSTANCE', id);
    expect(syncEndpoint(':/app', {})).toEqual({ id, remote: '/app' });
    expect(syncEndpoint(`${id2}:/app`, {})).toEqual({ id: id2, remote: '/app' });
    expect(syncEndpoint('/app', {})).toEqual({ local: '/app' });
    expect(() => syncEndpoint(':/', {})).toThrow('project directory');
  });
});
