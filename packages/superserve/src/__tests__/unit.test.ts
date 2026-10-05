import { describe, it, expect, vi, beforeEach } from 'vitest';

const files = new Map<string, string>();
const dirs = new Set<string>();
const runCalls: string[] = [];
const createCalls: Array<Record<string, unknown>> = [];
const publishedPorts: number[] = [];
let pwdFails = false;

const fakeSnapshot = {
  id: 'snap-1',
  sandboxId: 'sb-test',
  status: 'ready',
  sizeBytes: 1024,
  createdAt: new Date(0),
};

class FakeSandbox {
  id = 'sb-test';
  publishPreviewPort = async (port: number) => {
    publishedPorts.push(port);
  };
  getPreviewUrl = (port: number) => `https://${port}-sb-test.sandbox.example.com`;
  snapshot = async (options: { name?: string }) => ({ ...fakeSnapshot, name: options.name });
  files = {
    readText: async (path: string) => {
      const v = files.get(path);
      if (v === undefined) throw new Error(`not found: ${path}`);
      return v;
    },
    write: async (path: string, content: string) => {
      files.set(path, content);
    },
  };
  commands = {
    run: async (command: string, options?: { onStdout?: (data: string) => void }) => {
      runCalls.push(command);
      options?.onStdout?.('streamed');
      if (command === 'pwd') {
        return pwdFails
          ? { stdout: '', stderr: 'boom', exitCode: 1 }
          : { stdout: '/root\n', stderr: '', exitCode: 0 };
      }
      if (command.startsWith('mkdir -p "')) {
        dirs.add(command.slice('mkdir -p "'.length, -1));
        return { stdout: '', stderr: '', exitCode: 0 };
      }
      if (command.startsWith('test -e "')) {
        const p = command.slice('test -e "'.length, -1);
        return { stdout: '', stderr: '', exitCode: files.has(p) || dirs.has(p) ? 0 : 1 };
      }
      if (command.startsWith('rm -rf "')) {
        const p = command.slice('rm -rf "'.length, -1);
        files.delete(p);
        dirs.delete(p);
        return { stdout: '', stderr: '', exitCode: 0 };
      }
      return { stdout: '', stderr: '', exitCode: 0 };
    },
  };
}

vi.mock('@superserve/sdk', () => ({
  AuthenticationError: class extends Error {},
  Sandbox: class {
    static create = async (options: Record<string, unknown>) => {
      createCalls.push(options);
      return new FakeSandbox();
    };
    static connect = async () => new FakeSandbox();
    static list = async () => [];
    static killById = async () => {};
  },
  Snapshot: class {
    static list = async () => [fakeSnapshot];
    static deleteById = async () => {};
  },
  Template: class {
    static list = async () => [];
    static deleteById = async () => {};
  },
}));

import { superserve } from '../index';

describe('superserve relative filesystem paths', () => {
  beforeEach(() => {
    files.clear();
    dirs.clear();
    runCalls.length = 0;
    pwdFails = false;
  });

  it('resolves relative paths against the exec cwd', async () => {
    const provider = superserve({ apiKey: 'test' });
    const sandbox = await provider.sandbox.create();

    await sandbox.filesystem.writeFile('bench/file.txt', 'x');
    expect(files.get('/root/bench/file.txt')).toBe('x');

    // `.` and duplicate slashes normalize; `..` is preserved for the sandbox
    // filesystem to resolve physically (a preceding component may be a symlink).
    expect(await sandbox.filesystem.readFile('./bench/file.txt')).toBe('x');
    expect(await sandbox.filesystem.exists('bench//file.txt')).toBe(true);
    await sandbox.filesystem.writeFile('a/../b.txt', 'y');
    expect(files.get('/root/a/../b.txt')).toBe('y');

    await sandbox.filesystem.mkdir('bench/dir');
    expect(dirs.has('/root/bench/dir')).toBe(true);
    await sandbox.filesystem.remove('bench/dir');
    expect(dirs.has('/root/bench/dir')).toBe(false);

    // The workdir is probed once (`pwd`) and cached across operations.
    expect(runCalls.filter((c) => c === 'pwd')).toHaveLength(1);
  });

  it('does not cache a failed workdir probe', async () => {
    pwdFails = true;
    const provider = superserve({ apiKey: 'test' });
    const sandbox = await provider.sandbox.create();

    // Failed probe falls back to '/' for this op only — it is not cached.
    await sandbox.filesystem.writeFile('x.txt', 'x');
    expect(files.get('/x.txt')).toBe('x');

    pwdFails = false;
    await sandbox.filesystem.writeFile('y.txt', 'y');
    expect(files.get('/root/y.txt')).toBe('y');
    expect(runCalls.filter((c) => c === 'pwd')).toHaveLength(2);
  });

  it('rejects ambiguous paths in remove', async () => {
    const provider = superserve({ apiKey: 'test' });
    const sandbox = await provider.sandbox.create();

    for (const p of ['', '.', './', './.']) {
      await expect(sandbox.filesystem.remove(p)).rejects.toThrow();
    }
    expect(runCalls.filter((c) => c.startsWith('rm -rf'))).toHaveLength(0);
  });

  it('passes absolute paths through without probing', async () => {
    const provider = superserve({ apiKey: 'test' });
    const sandbox = await provider.sandbox.create();

    await sandbox.filesystem.writeFile('/abs/file.txt', 'x');
    expect(files.get('/abs/file.txt')).toBe('x');
    expect(runCalls.filter((c) => c === 'pwd')).toHaveLength(0);
  });
});

describe('superserve previews, streaming and snapshots', () => {
  beforeEach(() => {
    runCalls.length = 0;
    createCalls.length = 0;
    publishedPorts.length = 0;
  });

  it('publishes the port before returning its preview URL', async () => {
    const provider = superserve({ apiKey: 'test' });
    const sandbox = await provider.sandbox.create();

    expect(await sandbox.getUrl({ port: 3000 })).toBe('https://3000-sb-test.sandbox.example.com');
    expect(await sandbox.getUrl({ port: 8080, protocol: 'wss' })).toBe('wss://8080-sb-test.sandbox.example.com');
    expect(publishedPorts).toEqual([3000, 8080]);
  });

  it('streams output through the SDK instead of the daemon bridge', async () => {
    const provider = superserve({ apiKey: 'test' });
    const sandbox = await provider.sandbox.create();
    const chunks: string[] = [];

    await sandbox.runCommand('echo hi', { onStdout: (data) => chunks.push(data) });

    expect(chunks).toEqual(['streamed']);
    // The command reaches the sandbox as-is, not wrapped in a daemon bootstrap.
    expect(runCalls).toEqual(['echo hi']);
  });

  it('creates sandboxes from snapshots and lists snapshots per sandbox', async () => {
    const provider = superserve({ apiKey: 'test' });

    await provider.sandbox.create({ snapshotId: 'snap-1' });
    expect(createCalls[0]).toMatchObject({ fromSnapshot: 'snap-1' });

    expect(await provider.snapshot!.create('sb-test', { name: 'before-upgrade' })).toMatchObject({
      id: 'snap-1',
      provider: 'superserve',
      metadata: { name: 'before-upgrade', sandboxId: 'sb-test' },
    });

    // An unscoped list must not throw: compute.snapshot.list() calls every
    // provider without options.
    expect(await provider.snapshot!.list()).toEqual([]);
    expect(await provider.snapshot!.list({ sandboxId: 'sb-test' })).toHaveLength(1);
  });
});
