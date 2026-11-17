import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  createParams: [] as any[],
  egress: [] as any[],
  streams: [] as any[],
  snapshotStatuses: [] as string[],
  disks: [{ id: 'disk-1', name: 'data', sizeBytes: 10, status: 'ready', attachments: [] }],
}));

vi.mock('@boxd-sh/sdk', () => {
  class FakeStream {
    stdinData = '';
    closed = false;
    private resolveExit!: (code: number) => void;
    private exit = new Promise<number>((resolve) => { this.resolveExit = resolve; });
    private outQueue: string[] = [];
    private errQueue: string[] = [];
    private wakers = new Set<() => void>();
    private wake() { for (const w of this.wakers) w(); this.wakers.clear(); }
    private ended = false;
    constructor(public params: any) {}
    stdout = this.channel(this.outQueue);
    stderr = this.channel(this.errQueue);
    private channel(queue: string[]) {
      const self = this;
      return {
        async *[Symbol.asyncIterator]() {
          for (;;) {
            if (queue.length) { yield new TextEncoder().encode(queue.shift()!); continue; }
            if (self.ended) return;
            await new Promise<void>((resolve) => { self.wakers.add(resolve); });
          }
        },
      };
    }
    [Symbol.asyncIterator]() { return this.stdout[Symbol.asyncIterator](); }
    emit(out: string, err = '') {
      if (out) this.outQueue.push(out);
      if (err) this.errQueue.push(err);
      this.wake();
    }
    finish(code: number) { this.ended = true; this.wake(); this.resolveExit(code); }
    write(data: string) { this.stdinData += data; }
    end() { this.emit(this.stdinData); this.finish(0); }
    wait() { return this.exit; }
    close() { if (!this.closed) { this.closed = true; this.ended = true; this.wake(); this.resolveExit(-1); } }
  }

  const machine = { id: 'm-1', name: 'box', status: 'running', createdAt: new Date(), deleteAt: null, access: { url: 'box.boxd.sh' } };

  class Boxd {
    machines = {
      create: async (params: any) => { state.createParams.push(params); return machine; },
      waitUntilReady: async () => machine,
      get: async () => machine,
      setEgressAllow: async (id: string, entries: string[]) => { state.egress.push([id, entries]); return entries; },
      streamExec: (_id: string, params: any) => { const s = new FakeStream(params); state.streams.push(s); return s; },
    };
    snapshots = {
      get: async () => ({ name: 'snap', status: state.snapshotStatuses.shift() ?? 'ready' }),
    };
    disks = { list: async () => state.disks };
  }

  class NotFoundError extends Error {}
  class ConflictError extends Error {}
  return { Boxd, NotFoundError, ConflictError };
});

import { boxd } from '../index';

describe('boxd provider (mocked SDK)', () => {
  const provider = boxd({ apiKey: 'bxd_test' });

  beforeEach(() => {
    state.createParams.length = 0;
    state.egress.length = 0;
    state.streams.length = 0;
  });

  it('creates isolated machines and maps egress, volumes, image and sizing', async () => {
    await provider.sandbox.create({
      image: 'ubuntu:24.04',
      egress: ['api.example.com'],
      volumes: [{ volume: 'data', mountPath: '/mnt/data' }],
      vcpus: 2,
      timeout: 60_000,
    });
    expect(state.createParams[0]).toMatchObject({
      image: 'ubuntu:24.04',
      isolated: true,
      deleteAfter: 60,
      config: { vcpu: 2, volumes: [{ diskId: 'disk-1', mountPath: '/mnt/data' }] },
    });
    expect(state.egress).toEqual([['m-1', ['api.example.com']]]);
  });

  it('reports every standard size class as unsupported, since none matches a boxd size exactly', () => {
    for (const resolution of provider.sizes.list()) {
      expect(resolution.status).toBe('unsupported');
    }
    expect(provider.sizes.resolve('md')).toMatchObject({ reason: expect.stringContaining('1/4, 2/8, 4/16, 8/32') });
  });

  it('rejects the egress router form', async () => {
    await expect(provider.sandbox.create({ egress: { injectorUrl: 'https://x', credentialedHosts: [] } })).rejects.toThrow(/^egress:/);
  });

  it('streams command output and reports the exit code', async () => {
    const sandbox = await provider.sandbox.create();
    const chunks: string[] = [];
    const errs: string[] = [];
    const pending = sandbox.runCommand('build', { env: { A: 'b' }, onStdout: (t) => chunks.push(t), onStderr: (t) => errs.push(t) });
    await vi.waitFor(() => expect(state.streams).toHaveLength(1));
    const stream = state.streams[0];
    expect(stream.params).toMatchObject({ command: 'export A="b"; build', closeStdin: true });
    stream.emit('one\n', 'warn\n');
    stream.emit('two\n');
    setTimeout(() => stream.finish(3), 10);
    const result = await pending;
    expect(result.exitCode).toBe(3);
    expect(chunks.join('')).toBe('one\ntwo\n');
    expect(result.stdout).toBe('one\ntwo\n');
    expect(errs.join('')).toBe('warn\n');
  });

  it('closes a streaming command at its timeout', async () => {
    const sandbox = await provider.sandbox.create();
    const result = await sandbox.runCommand('sleep 60', { timeout: 50, onStdout: () => {} });
    expect(result.exitCode).toBe(124);
    expect(state.streams[0].closed).toBe(true);
  });

  it('runs interactive processes over streamExec', async () => {
    const sandbox = await provider.sandbox.create();
    const proc = await sandbox.startProcess('cat', { stdin: true });
    expect(state.streams[0].params.closeStdin).toBe(false);
    await proc.write('hello\n');
    await proc.closeStdin();
    const result = await proc.wait({ timeout: 1000 });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('hello\n');
    expect((await proc.status()).status).toBe('exited');
  });

  it('kills a process by closing its stream', async () => {
    const sandbox = await provider.sandbox.create();
    const proc = await sandbox.startProcess('sleep 600', {});
    await proc.kill('SIGKILL');
    const status = await proc.status();
    expect(status).toMatchObject({ status: 'exited', exitCode: null, signal: 'SIGKILL' });
  });

  it('waits for a pending snapshot to become ready', async () => {
    state.snapshotStatuses.push('pending', 'pending');
    vi.useFakeTimers();
    try {
      const ready = provider.snapshot!.waitUntilReady!('snap', { timeoutMs: 60_000 });
      await vi.advanceTimersByTimeAsync(5000);
      await expect(ready).resolves.toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });
});
