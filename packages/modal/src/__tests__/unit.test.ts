import { describe, it, expect, vi, beforeEach } from 'vitest';

const files = new Map<string, string>();
let openCalls = 0;

class FakeSandbox {
  sandboxId = 'sb-test';
  filesystem = {
    writeText: async (data: string, path: string) => { files.set(path, data); },
    readText: async (path: string) => {
      const v = files.get(path);
      if (v === undefined) throw new Error(`SandboxFilesystemNotFoundError: ${path}`);
      return v;
    },
  };
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
}));

import { modal } from '../index';

describe('modal filesystem read/write', () => {
  beforeEach(() => { files.clear(); openCalls = 0; });

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

  it('surfaces a descriptive error when a read fails', async () => {
    const provider = modal({ tokenId: 't', tokenSecret: 's' });
    const sandbox = await provider.sandbox.create();

    await expect(sandbox.filesystem.readFile('/missing.txt')).rejects.toThrow(/Failed to read file \/missing\.txt/);
  });
});
