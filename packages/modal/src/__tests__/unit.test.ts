import { describe, it, expect, vi, beforeEach } from 'vitest';

const files = new Map<string, string>();
const dirs = new Set<string>();
let openCalls = 0;
let readLimit = Infinity;
const execCalls: string[][] = [];

class FakeSandbox {
  sandboxId = 'sb-test';
  filesystem = {
    writeText: async (data: string, path: string) => { files.set(path, data); },
    readText: async (path: string) => {
      const v = files.get(path);
      if (v === undefined) throw new Error(`SandboxFilesystemNotFoundError: ${path}`);
      if (v.length > readLimit) throw new FakeFileTooLargeError('too large');
      return v;
    },
    makeDirectory: async (path: string, options?: { createParents?: boolean }) => {
      fsCalls.push(['makeDirectory', path, JSON.stringify(options)]);
      dirs.add(path);
    },
    listFiles: async (path: string) => {
      if (!dirs.has(path)) throw new FakeNotFoundError('missing');
      return [
        { name: 'a.txt', path: `${path}/a.txt`, type: 'file', size: 3, mode: 0o644, permissions: '-rw-r--r--', owner: 'root', group: 'root', modifiedTime: 1_700_000_000, symlinkTarget: null },
        { name: 'sub dir', path: `${path}/sub dir`, type: 'directory', size: 0, mode: 0o755, permissions: 'drwxr-xr-x', owner: 'root', group: 'root', modifiedTime: 1_700_000_001, symlinkTarget: null },
      ];
    },
    stat: async (path: string) => {
      if (!files.has(path) && !dirs.has(path)) throw new FakeNotFoundError('missing');
      return {};
    },
    remove: async (path: string, options?: { recursive?: boolean }) => {
      fsCalls.push(['remove', path, JSON.stringify(options)]);
      if (!files.delete(path) && !dirs.delete(path)) throw new FakeNotFoundError('missing');
    },
  };
  async exec(command: string[]) {
    execCalls.push(command);
    const content = files.get(command[1]) ?? '';
    return {
      stdout: { readText: async () => content },
      stderr: { readText: async () => '' },
      wait: async () => 0,
    };
  }
  async open() {
    openCalls++;
    throw new Error('Sandbox.open is not supported for V2 sandboxes');
  }
}

const fsCalls: string[][] = [];

vi.mock('modal', () => ({
  SandboxFilesystemFileTooLargeError: class extends Error {},
  SandboxFilesystemNotFoundError: class extends Error {},
  ModalClient: class {
    apps = { fromName: async () => ({}) };
    images = { fromRegistry: () => ({ build: async () => ({}) }) };
    sandboxes = {
      create: async () => new FakeSandbox(),
      experimentalCreate: async () => new FakeSandbox(),
      fromId: async () => new FakeSandbox(),
    };
  },
  Image: class {},
}));

import { modal } from '../index';
import {
  SandboxFilesystemFileTooLargeError as FakeFileTooLargeError,
  SandboxFilesystemNotFoundError as FakeNotFoundError,
} from 'modal';

describe('modal filesystem read/write', () => {
  beforeEach(() => { files.clear(); dirs.clear(); openCalls = 0; readLimit = Infinity; execCalls.length = 0; fsCalls.length = 0; });

  it('uses Sandbox.filesystem (V1 and V2 compatible) instead of the deprecated Sandbox.open', async () => {
    const provider = modal({ tokenId: 't', tokenSecret: 's', scalableSandboxes: true });
    const sandbox = await provider.sandbox.create();

    const content = '  x'.repeat(50_000) + '\n';
    await sandbox.filesystem.writeFile('/tmp/bench/file.txt', content);
    expect(files.get('/tmp/bench/file.txt')).toBe(content);

    // Content round-trips untouched (no trimming).
    expect(await sandbox.filesystem.readFile('/tmp/bench/file.txt')).toBe(content);
    expect(openCalls).toBe(0);
  });

  it('falls back to cat when the file exceeds the filesystem read limit', async () => {
    const provider = modal({ tokenId: 't', tokenSecret: 's' });
    const sandbox = await provider.sandbox.create();
    const content = '  big\n'.repeat(1000);
    files.set('/big.txt', content);
    readLimit = 10;

    expect(await sandbox.filesystem.readFile('/big.txt')).toBe(content);
    expect(execCalls).toEqual([['cat', '/big.txt']]);
  });

  it('routes mkdir/readdir/exists/remove through Sandbox.filesystem', async () => {
    const provider = modal({ tokenId: 't', tokenSecret: 's', scalableSandboxes: true });
    const sandbox = await provider.sandbox.create();

    await sandbox.filesystem.mkdir('/tmp/bench/fs-1');
    expect(fsCalls).toEqual([['makeDirectory', '/tmp/bench/fs-1', '{"createParents":true}']]);

    expect(await sandbox.filesystem.readdir('/tmp/bench/fs-1')).toEqual([
      { name: 'a.txt', type: 'file', size: 3, modified: new Date(1_700_000_000_000) },
      { name: 'sub dir', type: 'directory', size: 0, modified: new Date(1_700_000_001_000) },
    ]);

    expect(await sandbox.filesystem.exists('/tmp/bench/fs-1')).toBe(true);
    expect(await sandbox.filesystem.exists('/nope')).toBe(false);

    await sandbox.filesystem.remove('/tmp/bench/fs-1');
    expect(fsCalls[1]).toEqual(['remove', '/tmp/bench/fs-1', '{"recursive":true}']);
    expect(await sandbox.filesystem.exists('/tmp/bench/fs-1')).toBe(false);

    // Removing a missing path is a no-op, matching `rm -rf`.
    await expect(sandbox.filesystem.remove('/tmp/bench/fs-1')).resolves.toBeUndefined();
    expect(execCalls).toEqual([]);
  });

  it('surfaces a descriptive error when a read fails', async () => {
    const provider = modal({ tokenId: 't', tokenSecret: 's' });
    const sandbox = await provider.sandbox.create();

    await expect(sandbox.filesystem.readFile('/missing.txt')).rejects.toThrow(/Failed to read file \/missing\.txt/);
  });
});
