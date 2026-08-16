import { beforeEach, describe, expect, it, vi } from 'vitest';

const mock = vi.hoisted(() => ({
  backendKind: 'local' as 'local' | 'cloud',
  backendScopes: 0,
  maxBackendScopes: 0,
  created: [] as Array<Record<string, unknown>>,
  handles: new Map<string, any>(),
  listPages: [] as Array<{ sandboxes: any[]; nextCursor?: string }>,
  execEvents: [] as Array<Record<string, unknown>>,
  execEventDelayMs: 0,
  execKilled: false,
}));

vi.mock('microsandbox', () => {
  class ExecBuilder {
    options: Record<string, unknown> = {};
    args(value: string[]) { this.options.args = value; return this; }
    cwd(value: string) { this.options.cwd = value; return this; }
    envs(value: Record<string, string>) { this.options.env = value; return this; }
    timeout(value: number) { this.options.timeout = value; return this; }
  }

  class FakeFs {
    files = new Map<string, string>();
    directories = new Set<string>(['/', '/tmp']);
    async readToString(path: string) {
      const value = this.files.get(path);
      if (value == null) throw new Error(`missing ${path}`);
      return value;
    }
    async write(path: string, value: string | Uint8Array) {
      this.files.set(path, typeof value === 'string' ? value : new TextDecoder().decode(value));
    }
    async list(path: string) {
      return [...this.files.keys()]
        .filter((entry) => entry.startsWith(`${path}/`))
        .map((entry) => ({ path: entry, kind: 'file', size: BigInt(this.files.get(entry)?.length ?? 0), modified: new Date(0) }));
    }
    async mkdir(path: string) { this.directories.add(path); }
    async exists(path: string) { return this.files.has(path) || this.directories.has(path); }
    async stat(path: string) { return { kind: this.directories.has(path) ? 'directory' : 'file' }; }
    async remove(path: string) { this.files.delete(path); }
    async removeDir(path: string) { this.directories.delete(path); }
  }

  class FakeSandbox {
    readonly backendKind: 'local' | 'cloud';
    readonly fsOps = new FakeFs();
    constructor(readonly name: string) {
      this.backendKind = mock.backendKind;
    }
    async execWith(_command: string, configure: (builder: ExecBuilder) => ExecBuilder) {
      const builder = configure(new ExecBuilder());
      const script = (builder.options.args as string[])[1];
      return {
        code: script.includes('missing-command') ? 127 : 0,
        stdout: () => script.includes('echo hello') ? 'hello\n' : '',
        stderr: () => script.includes('missing-command') ? 'not found\n' : '',
      };
    }
    async execStreamWith(_command: string, configure: (builder: ExecBuilder) => ExecBuilder) {
      configure(new ExecBuilder());
      const events = mock.execEvents;
      return {
        async *[Symbol.asyncIterator]() {
          for (const event of events) {
            if (mock.execEventDelayMs) await new Promise((resolve) => setTimeout(resolve, mock.execEventDelayMs));
            yield event;
          }
        },
        async kill() { mock.execKilled = true; },
      };
    }
    fs() { return this.fsOps; }
    async stopWithTimeout() {}
  }

  class FakeHandle {
    status = 'running';
    backendKind: 'local' | 'cloud';
    createdAt = new Date('2026-08-15T00:00:00Z');
    updatedAt = this.createdAt;
    configValue: Record<string, unknown>;
    native: FakeSandbox;
    constructor(readonly name: string, config: Record<string, unknown> = {}) {
      this.backendKind = mock.backendKind;
      this.configValue = config;
      this.native = new FakeSandbox(name);
    }
    config() { return this.configValue; }
    async refresh() { return this; }
    async connect() { return this.native; }
    async startDetached() { this.status = 'running'; return this.native; }
    async stopWithTimeout() { this.status = 'stopped'; }
    async remove() { mock.handles.delete(this.name); }
  }

  class SandboxListBuilder {
    cursorValue?: string;
    limit() { return this; }
    label() { return this; }
    cursor(value: string) { this.cursorValue = value; return this; }
  }

  class FakeSandboxBuilder {
    config: Record<string, unknown>;
    constructor(readonly name: string) {
      this.config = { name, ports: [] };
    }
    image(value: string) { this.config.image = value; return this; }
    fromSnapshot(value: string) { this.config.snapshot = value; return this; }
    rootDisk(value: number) { this.config.rootDisk = value; return this; }
    cpus(value: number) { this.config.cpus = value; return this; }
    memory(value: number) { this.config.memory = value; return this; }
    detached(value: boolean) { this.config.detached = value; return this; }
    maxDuration(value: number) { this.config.maxDuration = value; return this; }
    labels(value: Record<string, string>) { this.config.labels = value; return this; }
    workdir(value: string) { this.config.workdir = value; return this; }
    envs(value: Record<string, string>) { this.config.envs = value; return this; }
    pullPolicy(value: string) { this.config.pullPolicy = value; return this; }
    disableNetwork() { this.config.networkDisabled = true; return this; }
    port(host: number, guest: number) { (this.config.ports as unknown[]).push({ host, guest }); return this; }
    portBind(bind: string, host: number, guest: number) { (this.config.ports as unknown[]).push({ bind, host, guest }); return this; }
    async create() {
      await new Promise((resolve) => setTimeout(resolve, 5));
      mock.created.push({ ...this.config, backend: mock.backendKind });
      const sandbox = new FakeSandbox(this.name);
      const handle = new FakeHandle(this.name, {
        labels: this.config.labels,
        network: { ports: this.config.ports },
      });
      handle.native = sandbox;
      mock.handles.set(this.name, handle);
      return sandbox;
    }
  }

  return {
    defaultBackendKind: () => mock.backendKind,
    withDefaultBackend: async (backend: 'local' | { kind: 'cloud' }, operation: () => Promise<unknown>) => {
      const previous = mock.backendKind;
      mock.backendKind = backend === 'local' ? 'local' : 'cloud';
      mock.backendScopes += 1;
      mock.maxBackendScopes = Math.max(mock.maxBackendScopes, mock.backendScopes);
      try {
        return await operation();
      } finally {
        mock.backendScopes -= 1;
        mock.backendKind = previous;
      }
    },
    Sandbox: {
      builder: (name: string) => new FakeSandboxBuilder(name),
      get: async (name: string) => {
        const handle = mock.handles.get(name);
        if (!handle) throw Object.assign(new Error('not found'), { code: 'sandboxNotFound' });
        return handle;
      },
      listWith: async (configure: (builder: SandboxListBuilder) => SandboxListBuilder) => {
        const builder = configure(new SandboxListBuilder());
        const index = builder.cursorValue ? Number(builder.cursorValue) : 0;
        return mock.listPages[index] ?? { sandboxes: [], nextCursor: undefined };
      },
    },
    Snapshot: {
      builder: () => { throw new Error('not implemented in unit mock'); },
      list: async () => [],
      get: async () => { throw new Error('not implemented in unit mock'); },
      remove: async () => {},
    },
  };
});

import { microsandbox } from '../index.js';

beforeEach(() => {
  mock.backendKind = 'local';
  mock.backendScopes = 0;
  mock.maxBackendScopes = 0;
  mock.created.length = 0;
  mock.handles.clear();
  mock.listPages.length = 0;
  mock.execEvents.length = 0;
  mock.execEventDelayMs = 0;
  mock.execKilled = false;
});

describe('microsandbox provider', () => {
  it('maps ComputeSDK create options to the local SDK and publishes ports', async () => {
    const provider = microsandbox({
      backend: 'local',
      image: 'node:22',
      workdir: '/workspace',
      ports: [{ bind: '127.0.0.1', host: 4300, guest: 3000 }],
    });
    const sandbox = await provider.sandbox.create({
      name: 'local-box',
      cpus: 2,
      memoryMiB: 1024,
      timeout: 60_000,
      envs: { MODE: 'test' },
      metadata: { requestId: 42 },
    });

    expect(mock.created[0]).toMatchObject({
      name: 'local-box',
      backend: 'local',
      image: 'node:22',
      cpus: 2,
      memory: 1024,
      maxDuration: 60,
      workdir: '/workspace',
      envs: { MODE: 'test' },
      ports: [{ bind: '127.0.0.1', host: 4300, guest: 3000 }],
    });
    expect(await sandbox.getUrl({ port: 3000 })).toBe('http://127.0.0.1:4300');
    expect((await sandbox.getInfo()).metadata).toMatchObject({ backend: 'local', requestId: 42 });
  });

  it('uses the cloud backend without requesting unsupported port publishing', async () => {
    const provider = microsandbox({
      backend: { kind: 'cloud', apiKey: 'secret' },
      ports: [3000],
    });
    const sandbox = await provider.sandbox.create({ name: 'cloud-box' });
    const instance = sandbox.getInstance();

    expect(mock.created[0]).toMatchObject({ backend: 'cloud', ports: [] });
    expect(instance).toMatchObject({ backendKind: 'cloud' });
    expect(instance).not.toHaveProperty('backend');
    expect(instance).not.toHaveProperty('apiKey');
    expect(await sandbox.getInfo()).toMatchObject({ id: 'cloud-box', status: 'running' });
    await expect(sandbox.getUrl({ port: 3000 })).rejects.toThrow(/cloud does not currently support published ports/);
    await expect(provider.snapshot?.list()).rejects.toThrow(/cloud does not currently support disk snapshots/);
  });

  it('serializes process-wide backend scopes across concurrent local and cloud creates', async () => {
    await Promise.all([
      microsandbox({ backend: 'local' }).sandbox.create({ name: 'local-concurrent' }),
      microsandbox({ backend: { kind: 'cloud', apiKey: 'secret' } }).sandbox.create({ name: 'cloud-concurrent' }),
    ]);

    expect(mock.maxBackendScopes).toBe(1);
    expect(mock.created.map((entry) => [entry.name, entry.backend])).toEqual([
      ['local-concurrent', 'local'],
      ['cloud-concurrent', 'cloud'],
    ]);
  });

  it('drains paginated sandbox listings and restores metadata and ports', async () => {
    const makeHandle = (name: string, host: number) => ({
      name,
      status: 'running',
      backendKind: 'local',
      createdAt: new Date(0),
      config: () => ({
        labels: { 'computesdk.metadata.owner': JSON.stringify('test') },
        network: { ports: [{ host, guest: 3000 }] },
      }),
      refresh: async function () { return this; },
      connect: async () => mock.handles.get(name)?.native,
    });
    mock.listPages.push(
      { sandboxes: [makeHandle('one', 4101)], nextCursor: '1' },
      { sandboxes: [makeHandle('two', 4102)] },
    );

    const sandboxes = await microsandbox({ backend: 'local' }).sandbox.list();

    expect(sandboxes.map((sandbox) => sandbox.sandboxId)).toEqual(['one', 'two']);
    expect(await sandboxes[1].getUrl({ port: 3000 })).toBe('http://127.0.0.1:4102');
    expect((await sandboxes[0].getInfo()).metadata).toMatchObject({ owner: 'test' });
  });

  it('executes commands and streams stdout and stderr through native events', async () => {
    const sandbox = await microsandbox({ backend: 'local' }).sandbox.create({ name: 'exec-box' });
    expect(await sandbox.runCommand('echo hello')).toMatchObject({ stdout: 'hello\n', exitCode: 0 });
    expect((await sandbox.runCommand('missing-command')).exitCode).toBe(127);

    mock.execEvents.push(
      { kind: 'started', pid: 1 },
      { kind: 'stdout', data: new TextEncoder().encode('out\n') },
      { kind: 'stderr', data: new TextEncoder().encode('err\n') },
      { kind: 'exited', code: 3 },
    );
    const stdout: string[] = [];
    const stderr: string[] = [];
    const result = await sandbox.runCommand('stream', {
      onStdout: (chunk) => stdout.push(chunk),
      onStderr: (chunk) => stderr.push(chunk),
    });

    expect(result).toMatchObject({ stdout: 'out\n', stderr: 'err\n', exitCode: 3 });
    expect(stdout).toEqual(['out\n']);
    expect(stderr).toEqual(['err\n']);
  });

  it('kills streaming commands at the requested timeout and reports a non-zero exit', async () => {
    const sandbox = await microsandbox({ backend: 'local' }).sandbox.create({ name: 'timeout-box' });
    mock.execEvents.push({ kind: 'exited', code: 0 });
    mock.execEventDelayMs = 20;

    const result = await sandbox.runCommand('sleep 60', { timeout: 5, onStdout: () => {} });

    expect(mock.execKilled).toBe(true);
    expect(result.exitCode).toBe(124);
  });

  it('uses the native filesystem surface', async () => {
    const sandbox = await microsandbox({ backend: 'local' }).sandbox.create({ name: 'fs-box' });
    await sandbox.filesystem.mkdir('/workspace');
    await sandbox.filesystem.writeFile('/workspace/hello.txt', 'hello');

    expect(await sandbox.filesystem.readFile('/workspace/hello.txt')).toBe('hello');
    expect(await sandbox.filesystem.exists('/workspace/hello.txt')).toBe(true);
    expect(await sandbox.filesystem.readdir('/workspace')).toEqual([
      { name: 'hello.txt', type: 'file', size: 5, modified: new Date(0) },
    ]);
    await sandbox.filesystem.remove('/workspace/hello.txt');
    expect(await sandbox.filesystem.exists('/workspace/hello.txt')).toBe(false);
  });
});
