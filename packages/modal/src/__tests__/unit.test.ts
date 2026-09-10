import { describe, it, expect, vi, beforeEach } from 'vitest';

const files = new Map<string, string>();
let openCalls = 0;
let readLimit = Infinity;
const execCalls: string[][] = [];

class FakeFileTooLargeError extends Error {}

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

vi.mock('modal', () => ({
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
  SandboxFilesystemFileTooLargeError: FakeFileTooLargeError,
}));

import { modal } from '../index';

describe('modal filesystem read/write', () => {
  beforeEach(() => { files.clear(); openCalls = 0; readLimit = Infinity; execCalls.length = 0; });

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

  it('surfaces a descriptive error when a read fails', async () => {
    const provider = modal({ tokenId: 't', tokenSecret: 's' });
    const sandbox = await provider.sandbox.create();

    await expect(sandbox.filesystem.readFile('/missing.txt')).rejects.toThrow(/Failed to read file \/missing\.txt/);
  });
});
