import { describe, it, expect, vi, beforeEach } from 'vitest';

interface ExecRecord { command: string[]; mode?: string; chunks: Uint8Array[]; closedStdin: boolean }
const execCalls: ExecRecord[] = [];
let openSupported = true;
let failStdinWrite = false;

class FakeProcess {
  stdin: WritableStream<Uint8Array>;
  stdout = { readText: async () => '', readBytes: async () => new Uint8Array() };
  stderr = { readText: async () => '', readBytes: async () => new Uint8Array() };
  constructor(private record: ExecRecord) {
    this.stdin = new WritableStream<Uint8Array>({
      write: (chunk) => {
        if (failStdinWrite) throw new Error('rpc failed');
        record.chunks.push(chunk);
      },
    });
  }
  async closeStdin() { this.record.closedStdin = true; }
  async wait() { return 0; }
}

class FakeSandbox {
  sandboxId = 'sb-test';
  async open() {
    if (!openSupported) throw new Error('Sandbox.open is not supported for V2 sandboxes');
    return { write: async () => {}, close: async () => {} };
  }
  async exec(command: string[], params?: { mode?: string }) {
    const record: ExecRecord = { command, mode: params?.mode, chunks: [], closedStdin: false };
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

const decode = (chunks: Uint8Array[]) => chunks.map((c) => new TextDecoder().decode(c)).join('');

describe('modal filesystem.writeFile', () => {
  beforeEach(() => { execCalls.length = 0; openSupported = true; failStdinWrite = false; });

  it('falls back to a stdin-fed shell write when Sandbox.open is unsupported (V2)', async () => {
    openSupported = false;
    const provider = modal({ tokenId: 't', tokenSecret: 's', scalableSandboxes: true });
    const sandbox = await provider.sandbox.create();

    await sandbox.filesystem.writeFile('/tmp/bench/file.txt', 'hello world');

    expect(execCalls).toHaveLength(1);
    expect(execCalls[0].command).toEqual(['sh', '-c', 'cat > "/tmp/bench/file.txt"']);
    expect(execCalls[0].mode).toBe('binary');
    expect(decode(execCalls[0].chunks)).toBe('hello world');
  });

  it('streams large V2 writes in bounded chunks', async () => {
    openSupported = false;
    const provider = modal({ tokenId: 't', tokenSecret: 's', scalableSandboxes: true });
    const sandbox = await provider.sandbox.create();
    const content = 'x'.repeat(9 * 1024 * 1024);

    await sandbox.filesystem.writeFile('/tmp/big.txt', content);

    const { chunks } = execCalls[0];
    expect(chunks).toHaveLength(3);
    expect(Math.max(...chunks.map((c) => c.length))).toBe(4 * 1024 * 1024);
    expect(decode(chunks)).toBe(content);
  });

  it('closes stdin so cat exits when a V2 stdin write fails', async () => {
    openSupported = false;
    failStdinWrite = true;
    const provider = modal({ tokenId: 't', tokenSecret: 's', scalableSandboxes: true });
    const sandbox = await provider.sandbox.create();

    await expect(sandbox.filesystem.writeFile('/tmp/file.txt', 'data')).rejects.toThrow('rpc failed');
    expect(execCalls[0].closedStdin).toBe(true);
  });

  it('uses Sandbox.open when it is supported', async () => {
    const provider = modal({ tokenId: 't', tokenSecret: 's' });
    const sandbox = await provider.sandbox.create();

    await sandbox.filesystem.writeFile('/tmp/file.txt', 'data');

    expect(execCalls).toHaveLength(0);
  });
});
