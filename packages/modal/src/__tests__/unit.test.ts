import { describe, it, expect, vi, beforeEach } from 'vitest';

const execCalls: { command: string[]; stdin: string }[] = [];
let openSupported = true;

class FakeProcess {
  private buffered = '';
  stdin = new WritableStream<string>({
    write: (chunk) => { this.buffered += chunk; },
    close: () => { this.record.stdin = this.buffered; },
  });
  stdout = { readText: async () => '' };
  stderr = { readText: async () => '' };
  constructor(private record: { command: string[]; stdin: string }) {}
  async wait() { return 0; }
}

class FakeSandbox {
  sandboxId = 'sb-test';
  async open() {
    if (!openSupported) throw new Error('Sandbox.open is not supported for V2 sandboxes');
    return { write: async () => {}, close: async () => {} };
  }
  async exec(command: string[]) {
    const record = { command, stdin: '' };
    execCalls.push(record);
    return new FakeProcess(record);
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

describe('modal filesystem.writeFile', () => {
  beforeEach(() => { execCalls.length = 0; openSupported = true; });

  it('falls back to a stdin-fed shell write when Sandbox.open is unsupported (V2)', async () => {
    openSupported = false;
    const provider = modal({ tokenId: 't', tokenSecret: 's', scalableSandboxes: true });
    const sandbox = await provider.sandbox.create();

    await sandbox.filesystem.writeFile('/tmp/bench/file.txt', 'hello world');

    expect(execCalls).toHaveLength(1);
    expect(execCalls[0].command).toEqual(['sh', '-c', 'cat > "/tmp/bench/file.txt"']);
    expect(execCalls[0].stdin).toBe('hello world');
  });

  it('uses Sandbox.open when it is supported', async () => {
    const provider = modal({ tokenId: 't', tokenSecret: 's' });
    const sandbox = await provider.sandbox.create();

    await sandbox.filesystem.writeFile('/tmp/file.txt', 'data');

    expect(execCalls).toHaveLength(0);
  });
});
