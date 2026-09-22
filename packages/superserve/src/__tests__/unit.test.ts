import { describe, it, expect, vi, beforeEach } from 'vitest';

const files = new Map<string, string>();
const dirs = new Set<string>();
const runCalls: string[] = [];

class FakeSandbox {
  id = 'sb-test';
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
    run: async (command: string) => {
      runCalls.push(command);
      if (command === 'pwd') return { stdout: '/root\n', stderr: '', exitCode: 0 };
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
    static create = async () => new FakeSandbox();
    static connect = async () => new FakeSandbox();
    static list = async () => [];
    static killById = async () => {};
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

  it('passes absolute paths through without probing', async () => {
    const provider = superserve({ apiKey: 'test' });
    const sandbox = await provider.sandbox.create();

    await sandbox.filesystem.writeFile('/abs/file.txt', 'x');
    expect(files.get('/abs/file.txt')).toBe('x');
    expect(runCalls.filter((c) => c === 'pwd')).toHaveLength(0);
  });
});
