import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mock = vi.hoisted(() => ({
  backendKind: 'local' as 'local' | 'cloud',
  activeCreates: 0,
  maxActiveCreates: 0,
  backendSelections: [] as Array<'local' | { kind: 'cloud'; apiKey?: string; url?: string; profile?: string }>,
  created: [] as Array<Record<string, unknown>>,
  handles: new Map<string, any>(),
  listPages: [] as Array<{ sandboxes: any[]; nextCursor?: string }>,
  execEvents: [] as Array<Record<string, unknown>>,
  execEventDelayMs: 0,
  execKilled: false,
  detachedDies: false,
  detachedNeverDone: false,
  detachedNeverStarted: false,
  detachedLaunchDrops: false,
  detachedLateClaim: false,
  detachedLaunches: 0,
  detachedCommandRuns: 0,
  removeError: null as Error | null,
  stopFailures: 0,
  stopAttempts: 0,
  removeFailures: 0,
  removeAttempts: 0,
  createError: null as Error | null,
  createdStatus: 'running',
  skipHandleOnError: false,
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
    writes: Array<{ path: string; bytes: number }> = [];
    async write(path: string, value: string | Uint8Array) {
      this.writes.push({ path, bytes: typeof value === 'string' ? Buffer.byteLength(value) : value.byteLength });
      this.files.set(path, typeof value === 'string' ? value : new TextDecoder().decode(value));
    }
    async writeStream(path: string) {
      const chunks: Uint8Array[] = [];
      return {
        write: async (chunk: Uint8Array) => {
          this.writes.push({ path, bytes: chunk.byteLength });
          chunks.push(chunk);
        },
        close: async () => { this.files.set(path, Buffer.concat(chunks).toString('utf8')); },
      };
    }
    async readStream(path: string) {
      const value = this.files.get(path);
      if (value == null) throw new Error(`missing ${path}`);
      return { collect: async () => new TextEncoder().encode(value) };
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
      // Detached-exec protocol: launch writes pid/out/err/code files; status
      // probes return 0 once the code sentinel exists; cleanup removes them.
      const base = script.match(/\/tmp\/\.csdk-exec-[a-z0-9]+/)?.[0];
      if (base) {
        const [pid, out, err, code] = [`${base}.pid`, `${base}.out`, `${base}.err`, `${base}.code`];
        // Relaunch after a proven-dead worker prefixes `rm -f <pid>;`.
        const rm = script.match(/^rm -f ([^;]+);/);
        if (rm) for (const path of rm[1].trim().split(/\s+/)) this.fsOps.files.delete(path);
        if (script.includes('setsid ')) {
          mock.detachedLaunches++;
          const firstLaunch = mock.detachedLaunches === 1;
          const dropped = mock.detachedLaunchDrops && firstLaunch;
          // A slow first worker may claim the sentinel just as the relaunch
          // lands; whichever claims first runs the command, the other must
          // exit without running it again.
          if (mock.detachedLateClaim && !firstLaunch && !this.fsOps.files.has(pid)) {
            this.fsOps.files.set(pid, '9999');
            this.fsOps.files.set(out, 'late-worker\n');
            this.fsOps.files.set(err, '');
            this.fsOps.files.set(code, '0');
            mock.detachedCommandRuns++;
          }
          // The worker's pid write is noclobber: an existing sentinel means
          // a competing worker owns the run.
          if (!this.fsOps.files.has(pid) && !mock.detachedNeverStarted && !(dropped && !mock.detachedDies)) {
            this.fsOps.files.set(pid, '4242');
            const failed = script.includes('missing-command');
            this.fsOps.files.set(out, script.includes('echo hello') ? 'hello\n' : '');
            this.fsOps.files.set(err, failed ? 'not found\n' : '');
            if (!mock.detachedNeverDone) this.fsOps.files.set(code, failed ? '127' : '0');
            if (mock.detachedDies && firstLaunch) this.fsOps.files.delete(code);
            mock.detachedCommandRuns++;
          }
          if (dropped) throw new Error('exec session ended without exit event');
          return { code: 0, stdout: () => '', stderr: () => '' };
        }
        if (script.includes('test -f')) {
          if (this.fsOps.files.has(code)) return { code: 0, stdout: () => '', stderr: () => '' };
          if (!this.fsOps.files.has(pid)) return { code: 3, stdout: () => '', stderr: () => '' };
          if (mock.detachedDies) return { code: 2, stdout: () => '', stderr: () => '' };
          return { code: 1, stdout: () => '', stderr: () => '' };
        }
        if (script.startsWith('cat ')) {
          const target = script.match(/'([^']+)'/)?.[1] ?? '';
          return { code: 0, stdout: () => this.fsOps.files.get(target) ?? '', stderr: () => '' };
        }
        if (script.startsWith('rm -f') || script.includes('kill')) {
          for (const path of [pid, out, err, code]) this.fsOps.files.delete(path);
          return { code: 0, stdout: () => '', stderr: () => '' };
        }
      }
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
    async stopWithTimeout() {
      mock.stopAttempts++;
      if (mock.stopAttempts <= mock.stopFailures) throw new Error('temporary stop failure');
    }
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
    async stopWithTimeout() { await this.native.stopWithTimeout(); this.status = 'stopped'; }
    async waitUntilStopped() { return { name: this.name, status: this.status }; }
    async pause() { this.status = 'paused'; }
    async resume() { this.status = 'running'; }
    async remove() {
      mock.removeAttempts++;
      if (mock.removeAttempts <= mock.removeFailures) throw new Error('temporary deletion failure');
      if (mock.removeError) throw mock.removeError;
      mock.handles.delete(this.name);
    }
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
    rootDisk(value: number) { this.config.rootDisk = value; return this; }
    cpus(value: number) { this.config.cpus = value; return this; }
    memory(value: number) { this.config.memory = value; return this; }
    detached(value: boolean) { this.config.detached = value; return this; }
    ephemeral(value: boolean) { this.config.ephemeral = value; return this; }
    idleTimeout(value: number) { this.config.idleTimeout = value; return this; }
    labels(value: Record<string, string>) { this.config.labels = value; return this; }
    workdir(value: string) { this.config.workdir = value; return this; }
    envs(value: Record<string, string>) { this.config.envs = value; return this; }
    pullPolicy(value: string) { this.config.pullPolicy = value; return this; }
    disableNetwork() { this.config.networkDisabled = true; return this; }
    port(host: number, guest: number) { (this.config.ports as unknown[]).push({ host, guest }); return this; }
    portBind(bind: string, host: number, guest: number) { (this.config.ports as unknown[]).push({ bind, host, guest }); return this; }
    async create() {
      mock.activeCreates++;
      mock.maxActiveCreates = Math.max(mock.maxActiveCreates, mock.activeCreates);
      await new Promise((resolve) => setTimeout(resolve, 5));
      mock.activeCreates--;
      mock.created.push({ ...this.config, backend: mock.backendKind });
      const sandbox = new FakeSandbox(this.name);
      const handle = new FakeHandle(this.name, {
        labels: this.config.labels,
        network: { ports: this.config.ports },
      });
      handle.native = sandbox;
      handle.status = mock.createdStatus;
      if (mock.createError && mock.skipHandleOnError) throw mock.createError;
      mock.handles.set(this.name, handle);
      if (mock.createError) throw mock.createError;
      return sandbox;
    }
  }

  return {
    defaultBackendKind: () => mock.backendKind,
    defaultBackendInfo: () => ({
      kind: mock.backendKind,
      source: mock.backendSelections.length > 0 ? 'programmatic' : 'default',
    }),
    setDefaultBackend: (backend: 'local' | { kind: 'cloud' }) => {
      mock.backendSelections.push(backend);
      mock.backendKind = backend === 'local' ? 'local' : 'cloud';
    },
    Sandbox: {
      builder: (name: string) => new FakeSandboxBuilder(name),
      restore: (snapshot: string) => {
        let name = '';
        const builder = {
          name(value: string) { name = value; return builder; },
          idleTimeout() { return builder; },
          disableNetwork() { return builder; },
          port() { return builder; },
          portBind() { return builder; },
          async restore() {
            const fake = new FakeSandboxBuilder(name);
            fake.config.snapshot = snapshot;
            return fake.create();
          },
        };
        return builder;
      },
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
      // Mimic a backend without snapshot support: the adapter treats an
      // "unsupported" failure as its cue to use the disk-only fallback path.
      builder: () => { throw new Error('unsupported: snapshot capture is not implemented in unit mock'); },
      list: async () => [],
      get: async () => { throw new Error('not implemented in unit mock'); },
      remove: async () => {},
    },
  };
});

let microsandbox: typeof import('../index.js').microsandbox;

afterEach(() => {
  vi.unstubAllEnvs();
});

beforeEach(async () => {
  for (const name of ['MSB_API_KEY', 'MSB_API_URL', 'MSB_BACKEND', 'MSB_PROFILE']) vi.stubEnv(name, '');
  vi.resetModules();
  ({ microsandbox } = await import('../index.js'));
  mock.backendKind = 'local';
  mock.activeCreates = 0;
  mock.maxActiveCreates = 0;
  mock.backendSelections.length = 0;
  mock.created.length = 0;
  mock.handles.clear();
  mock.listPages.length = 0;
  mock.execEvents.length = 0;
  mock.execEventDelayMs = 0;
  mock.execKilled = false;
  mock.detachedDies = false;
  mock.detachedNeverDone = false;
  mock.detachedNeverStarted = false;
  mock.detachedLaunchDrops = false;
  mock.detachedLateClaim = false;
  mock.detachedLaunches = 0;
  mock.detachedCommandRuns = 0;
  mock.removeError = null;
  mock.stopFailures = 0;
  mock.stopAttempts = 0;
  mock.removeFailures = 0;
  mock.removeAttempts = 0;
  mock.createError = null;
  mock.createdStatus = 'running';
  mock.skipHandleOnError = false;
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
      idleTimeout: 60,
      workdir: '/workspace',
      envs: { MODE: 'test' },
      ports: [{ bind: '127.0.0.1', host: 4300, guest: 3000 }],
    });
    expect(await sandbox.getUrl({ port: 3000 })).toBe('http://127.0.0.1:4300');
    expect((await sandbox.getInfo()).metadata).toMatchObject({ backend: 'local', requestId: 42 });
  });

  it('lets a per-sandbox directory override the provider workdir', async () => {
    const provider = microsandbox({ backend: 'local', workdir: '/provider-default' });

    await provider.sandbox.create({ name: 'custom-workdir', directory: '/per-sandbox' });
    await provider.sandbox.create({ name: 'default-workdir' });

    expect(mock.created[0]).toMatchObject({ workdir: '/per-sandbox' });
    expect(mock.created[1]).toMatchObject({ workdir: '/provider-default' });
  });

  it('builds local URLs from explicit and wildcard bind addresses', async () => {
    const provider = microsandbox({
      backend: 'local',
      ports: [
        { bind: '192.0.2.10', host: 4301, guest: 3001 },
        { bind: '0.0.0.0', host: 4302, guest: 3002 },
        { bind: '::1', host: 4303, guest: 3003 },
        { bind: '::', host: 4304, guest: 3004 },
      ],
    });
    const sandbox = await provider.sandbox.create({ name: 'bound-ports' });

    expect(await sandbox.getUrl({ port: 3001 })).toBe('http://192.0.2.10:4301');
    expect(await sandbox.getUrl({ port: 3002 })).toBe('http://127.0.0.1:4302');
    expect(await sandbox.getUrl({ port: 3003, protocol: 'https' })).toBe('https://[::1]:4303');
    expect(await sandbox.getUrl({ port: 3004 })).toBe('http://[::1]:4304');
  });

  it('uses the cloud backend without requesting unsupported port publishing', async () => {
    const provider = microsandbox({
      apiKey: 'secret',
      apiUrl: 'https://cloud.example.test',
      ports: [3000],
    });
    const sandbox = await provider.sandbox.create({ name: 'cloud-box' });
    const instance = sandbox.getInstance();

    expect(mock.created[0]).toMatchObject({ backend: 'cloud', ports: [] });
    expect(mock.backendSelections[0]).toEqual({
      kind: 'cloud',
      apiKey: 'secret',
      url: 'https://cloud.example.test',
    });
    expect(instance).toMatchObject({ backendKind: 'cloud' });
    expect(instance).not.toHaveProperty('backend');
    expect(instance).not.toHaveProperty('apiKey');
    expect(await sandbox.getInfo()).toMatchObject({ id: 'cloud-box', status: 'running' });
    await expect(sandbox.getUrl({ port: 3000 })).rejects.toThrow(/cloud does not currently support published ports/);
    await expect(provider.snapshot?.list()).resolves.toEqual([]);
    await expect(sandbox.pause!()).rejects.toThrow(/cloud does not currently support pause\/resume/);
  });

  it('defaults to a cloud backend resolved by the microsandbox SDK', async () => {
    mock.backendKind = 'cloud';

    await microsandbox().sandbox.create({ name: 'default-cloud' });

    expect(mock.created[0]).toMatchObject({ name: 'default-cloud', backend: 'cloud' });
    expect(mock.backendSelections).toEqual([]);
  });

  it('uses MSB_API_KEY and MSB_API_URL from the environment for the cloud backend', async () => {
    vi.stubEnv('MSB_API_KEY', 'env-key');
    vi.stubEnv('MSB_API_URL', 'https://env.example.test');

    await microsandbox().sandbox.create({ name: 'env-cloud' });

    expect(mock.backendSelections).toEqual([
      { kind: 'cloud', apiKey: 'env-key', url: 'https://env.example.test' },
    ]);
    expect(mock.created[0]).toMatchObject({ name: 'env-cloud', backend: 'cloud' });
  });

  it('leaves MSB_BACKEND and MSB_PROFILE resolution to the microsandbox SDK', async () => {
    vi.stubEnv('MSB_API_KEY', 'env-key');
    vi.stubEnv('MSB_BACKEND', 'cloud');
    mock.backendKind = 'cloud';

    await microsandbox().sandbox.create({ name: 'sdk-env-cloud' });

    expect(mock.backendSelections).toEqual([]);
  });

  it('does not silently fall back to local when cloud is not configured', async () => {
    await expect(microsandbox().sandbox.create({ name: 'missing-cloud' })).rejects.toThrow(
      /cloud is the default.*MSB_API_KEY.*backend: 'local'/,
    );
    expect(mock.created).toEqual([]);
  });

  it('selects named cloud profiles and rejects conflicting backend options', async () => {
    await microsandbox({ profile: 'production' }).sandbox.create({ name: 'profile-cloud' });
    expect(mock.backendSelections[0]).toEqual({ kind: 'cloud', profile: 'production' });

    await expect(
      microsandbox({ backend: 'local', apiKey: 'secret' }).sandbox.create({ name: 'invalid-local' }),
    ).rejects.toThrow(/cloud credentials cannot be used with backend: 'local'/);
    await expect(
      microsandbox({ profile: 'production', apiKey: 'secret' }).sandbox.create({ name: 'invalid-profile' }),
    ).rejects.toThrow(/'profile' cannot be combined with 'apiKey' or 'apiUrl'/);
    await expect(
      microsandbox({ apiUrl: 'https://cloud.example.test' }).sandbox.create({ name: 'invalid-url' }),
    ).rejects.toThrow(/'apiUrl' requires 'apiKey'/);
  });

  it('creates concurrently across provider instances sharing the same credentials', async () => {
    await Promise.all(Array.from({ length: 3 }, (_, index) =>
      microsandbox({ apiKey: 'same-key' }).sandbox.create({ name: `parallel-${index}` }),
    ));
    expect(mock.maxActiveCreates).toBe(3);
    expect(mock.backendSelections).toHaveLength(1);
    expect(mock.created.every((sandbox) => sandbox.backend === 'cloud')).toBe(true);
  });

  it.each([
    { backend: 'local' as const },
    { apiKey: 'different-key' },
    { apiKey: 'same-key', apiUrl: 'https://other.example.test' },
    { profile: 'other-profile' },
  ])('serializes a different backend configuration behind in-flight work: %j', async (conflict) => {
    const creation = microsandbox({ apiKey: 'same-key' }).sandbox.create({ name: 'original' });
    await vi.waitFor(() => expect(mock.activeCreates).toBe(1), { interval: 1 });
    // The conflicting selection waits for the in-flight create instead of
    // interleaving with it, then installs its own backend and runs.
    const conflicting = microsandbox(conflict).sandbox.list();
    await creation;
    await conflicting;
    expect(mock.backendSelections).toHaveLength(2);
    expect(mock.backendSelections[0]).toEqual({ kind: 'cloud', apiKey: 'same-key' });
    expect(mock.created).toHaveLength(1);
    expect(mock.created[0]).toMatchObject({ name: 'original', backend: 'cloud' });
  });

  it('still rejects SDK-resolved cloud credentials once a programmatic backend is installed', async () => {
    await microsandbox({ apiKey: 'same-key' }).sandbox.create({ name: 'original' });
    // `microsandbox()` has no explicit override, and there is no way back to
    // the SDK's env/profile resolution once setDefaultBackend ran — fail closed.
    await expect(microsandbox().sandbox.list()).rejects.toThrow(/one backend configuration per process/);
    expect(mock.backendSelections).toEqual([{ kind: 'cloud', apiKey: 'same-key' }]);
  });

  it('switches backends after an earlier selection drains', async () => {
    await microsandbox({ backend: 'local' }).sandbox.create({ name: 'local' });
    await microsandbox({ apiKey: 'key' }).sandbox.list();
    expect(mock.backendSelections).toEqual(['local', { kind: 'cloud', apiKey: 'key' }]);
  });

  it('accepts memoryMib and per-create root disk overrides', async () => {
    const provider = microsandbox({ apiKey: 'key', memoryMib: 512, rootDiskMib: 4096 });
    await provider.sandbox.create({ name: 'dax', cpus: 8, memoryMib: 16384, rootDiskMib: 8192 });
    expect(mock.created[0]).toMatchObject({ cpus: 8, memory: 16384, rootDisk: 8192 });
    await provider.sandbox.create({ name: 'canonical', memoryMib: 1024, memoryMiB: 2048 });
    expect(mock.created[1]).toMatchObject({ memory: 2048, rootDisk: 4096 });
  });

  it('defaults to ephemeral sandboxes with a 15-minute idle timeout and supports overrides', async () => {
    await microsandbox({ apiKey: 'key' }).sandbox.create({ name: 'default' });
    await microsandbox({ apiKey: 'key' }).sandbox.create({ name: 'temporary', ephemeral: true, timeout: 900_000 });
    await microsandbox({ apiKey: 'key', ephemeral: false }).sandbox.create({ name: 'configured' });
    await microsandbox({ apiKey: 'key', ephemeral: true }).sandbox.create({ name: 'persistent', ephemeral: false });
    expect(mock.created.map((sandbox) => sandbox.ephemeral)).toEqual([true, true, false, false]);
    expect(mock.created[0].idleTimeout).toBe(900);
    expect(mock.created[1].idleTimeout).toBe(900);
  });

  it('retries normal shutdown and deletion independently', async () => {
    const provider = microsandbox({ apiKey: 'key' });
    await provider.sandbox.create({ name: 'retry-stop' });
    mock.stopFailures = 1;
    mock.removeFailures = 1;
    await provider.sandbox.destroy('retry-stop');
    expect(mock.stopAttempts).toBe(2);
    expect(mock.removeAttempts).toBe(2);
    expect(mock.handles.has('retry-stop')).toBe(false);
  });

  it('reports exhausted stop retries without attempting deletion', async () => {
    const provider = microsandbox({ apiKey: 'key' });
    await provider.sandbox.create({ name: 'stop-failed' });
    mock.stopFailures = 3;
    await expect(provider.sandbox.destroy('stop-failed')).rejects.toThrow('temporary stop failure');
    expect(mock.stopAttempts).toBe(3);
    expect(mock.removeAttempts).toBe(0);
  });

  it('never creates a sandbox for an already aborted request', async () => {
    const controller = new AbortController();
    controller.abort(new Error('deadline'));
    await expect(microsandbox({ apiKey: 'key' }).sandbox.create({ signal: controller.signal })).rejects.toThrow(/aborted/i);
    expect(mock.created).toEqual([]);
  });

  it('removes a sandbox when the request aborts during native creation', async () => {
    const controller = new AbortController();
    const creation = microsandbox({ apiKey: 'key' }).sandbox.create({ name: 'late', signal: controller.signal });
    const rejected = expect(creation).rejects.toThrow(/aborted/i);
    await vi.waitFor(() => expect(mock.activeCreates).toBe(1), { interval: 1 });
    controller.abort(new Error('deadline'));
    await rejected;
    // Cancellation returns before background cleanup finishes.
    await vi.waitFor(() => expect(mock.removeAttempts).toBe(1));
    expect(mock.created).toHaveLength(1);
    expect(mock.handles.has('late')).toBe(false);
  });

  it('retries deletion after a transient aborted-create cleanup failure', async () => {
    mock.removeFailures = 1;
    const controller = new AbortController();
    const creation = microsandbox({ apiKey: 'key' }).sandbox.create({ name: 'retry-cleanup', signal: controller.signal });
    const rejected = expect(creation).rejects.toThrow(/aborted/i);
    await vi.waitFor(() => expect(mock.activeCreates).toBe(1), { interval: 1 });
    controller.abort();
    await rejected;
    await vi.waitFor(() => expect(mock.removeAttempts).toBe(2));
    expect(mock.removeAttempts).toBe(2);
    expect(mock.handles.has('retry-cleanup')).toBe(false);
    expect(mock.backendKind).toBe('cloud');
  });

  it('removes the named sandbox when native creation fails after it exists', async () => {
    mock.createError = new Error('cloud sandbox "readiness" did not reach running before the readiness wait expired');
    mock.createdStatus = 'starting';
    await expect(microsandbox({ apiKey: 'key' }).sandbox.create({ name: 'readiness' })).rejects.toThrow(/readiness wait expired/);
    expect(mock.stopAttempts).toBe(1);
    expect(mock.removeAttempts).toBe(1);
    expect(mock.handles.has('readiness')).toBe(false);
  });

  it('does not remove an existing same-name sandbox when create fails', async () => {
    const provider = microsandbox({ apiKey: 'key' });
    await provider.sandbox.create({ name: 'worker-1' });
    const existing = mock.handles.get('worker-1');
    mock.createError = new Error('sandbox already exists');
    // Simulate a rejected duplicate: create throws without replacing the existing sandbox.
    mock.skipHandleOnError = true;
    await expect(provider.sandbox.create({ name: 'worker-1' })).rejects.toThrow('already exists');
    expect(mock.stopAttempts).toBe(0);
    expect(mock.removeAttempts).toBe(0);
    expect(mock.handles.get('worker-1')).toBe(existing);
  });

  it('keeps the create error when failed-create cleanup also fails', async () => {
    mock.createError = new Error('readiness wait expired');
    mock.removeError = new Error('permission denied: sensitive SDK details');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      await expect(microsandbox({ apiKey: 'key' }).sandbox.create({ name: 'leaky' })).rejects.toThrow('readiness wait expired');
      expect(mock.removeAttempts).toBe(3);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0][0]).toContain('leaky');
      expect(warn.mock.calls[0][0]).not.toContain('sensitive SDK details');
    } finally {
      warn.mockRestore();
    }
  });

  it('reports failed aborted-create cleanup without exposing SDK error details', async () => {
    mock.removeError = new Error('permission denied: sensitive SDK details');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const controller = new AbortController();
      const creation = microsandbox({ apiKey: 'key' }).sandbox.create({ name: 'cleanup-failed', signal: controller.signal });
      const rejected = expect(creation).rejects.toThrow(/aborted/i);
      await vi.waitFor(() => expect(mock.activeCreates).toBe(1), { interval: 1 });
      controller.abort();
      await rejected;
      await vi.waitFor(() => expect(warn).toHaveBeenCalledTimes(1));
      expect(mock.handles.has('cleanup-failed')).toBe(true);
      expect(mock.removeAttempts).toBe(3);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0][0]).toContain('cleanup-failed');
      expect(warn.mock.calls[0][0]).not.toContain('sensitive SDK details');
      expect(mock.backendKind).toBe('cloud');
    } finally {
      warn.mockRestore();
    }
  });

  it('drains paginated sandbox listings and restores metadata and ports', async () => {
    const makeHandle = (name: string, hostPort: number, hostBind: string) => ({
      name,
      status: 'running',
      backendKind: 'local',
      createdAt: new Date(0),
      config: () => ({
        labels: { 'computesdk.metadata.owner': JSON.stringify('test') },
        network: { ports: [{ hostPort, guestPort: 3000, hostBind }] },
      }),
      refresh: async function () { return this; },
      connect: async () => mock.handles.get(name)?.native,
    });
    mock.listPages.push(
      { sandboxes: [makeHandle('one', 4101, '127.0.0.1')], nextCursor: '1' },
      { sandboxes: [makeHandle('two', 4102, '192.0.2.20')] },
    );

    const sandboxes = await microsandbox({ backend: 'local' }).sandbox.list();

    expect(sandboxes.map((sandbox) => sandbox.sandboxId)).toEqual(['one', 'two']);
    expect(await sandboxes[1].getUrl({ port: 3000 })).toBe('http://192.0.2.20:4102');
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

  it('fails fast when the provider reaps the detached worker', async () => {
    const sandbox = await microsandbox({ backend: 'local' }).sandbox.create({ name: 'reaped-box' });
    mock.detachedDies = true;

    await expect(sandbox.runCommand('echo hello')).rejects.toThrow(/detached command died/);
  });

  it('fails fast when the detached worker never starts', async () => {
    const sandbox = await microsandbox({ backend: 'local' }).sandbox.create({ name: 'never-box' });
    mock.detachedNeverStarted = true;

    vi.useFakeTimers();
    try {
      const pending = sandbox.runCommand('echo hello');
      const assertion = expect(pending).rejects.toThrow(/never started/);
      await vi.advanceTimersByTimeAsync(60_000);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });

  it('runs the command once when a late first worker races the relaunch', async () => {
    const sandbox = await microsandbox({ backend: 'local' }).sandbox.create({ name: 'racy-box' });
    mock.detachedLaunchDrops = true;
    mock.detachedLateClaim = true;

    vi.useFakeTimers();
    try {
      const pending = sandbox.runCommand('echo hello');
      await vi.advanceTimersByTimeAsync(10_000);
      const result = await pending;

      // The slow first worker claimed the sentinel as the relaunch landed;
      // the relaunched worker must defer to it, not run the command again.
      expect(result.stdout).toBe('late-worker\n');
      expect(result.exitCode).toBe(0);
      expect(mock.detachedLaunches).toBe(2);
      expect(mock.detachedCommandRuns).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('clears the stale pid claim before relaunching a dead worker', async () => {
    const sandbox = await microsandbox({ backend: 'local' }).sandbox.create({ name: 'dead-worker-box' });
    mock.detachedLaunchDrops = true;
    mock.detachedDies = true;

    vi.useFakeTimers();
    try {
      const pending = sandbox.runCommand('echo hello');
      await vi.advanceTimersByTimeAsync(10_000);
      const result = await pending;

      // The dropped launch's worker claimed the pid then died; the relaunch
      // must remove that stale claim or its own noclobber claim can never
      // succeed.
      expect(result.stdout).toBe('hello\n');
      expect(result.exitCode).toBe(0);
      expect(mock.detachedLaunches).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('times out detached commands with partial output and exit 124', async () => {
    const sandbox = await microsandbox({ backend: 'local' }).sandbox.create({ name: 'slow-box' });
    mock.detachedNeverDone = true;

    const result = await sandbox.runCommand('sleep 60', { timeout: 5 });

    expect(result.exitCode).toBe(124);
  });

  it('pauses and resumes a local sandbox through the unified lifecycle', async () => {
    const provider = microsandbox({ backend: 'local' });
    const sandbox = await provider.sandbox.create({ name: 'pause-box' });

    expect(provider.sandbox.pause).toEqual({ memory: true });
    await sandbox.pause!();
    expect(mock.handles.get('pause-box')!.status).toBe('paused');
    await sandbox.resume!();
    expect(mock.handles.get('pause-box')!.status).toBe('running');
  });

  it('declares disk snapshots of a persistent source and restores by reference', async () => {
    const provider = microsandbox({ backend: 'local' });

    expect(provider.snapshot?.capabilities).toEqual({
      scope: 'rootfs',
      memory: false,
      destroysSource: false,
      createOptions: { ephemeral: false },
    });
    await provider.sandbox.create({ name: 'restored-box', snapshotId: 'snap-ref' } as any);
    expect(mock.created[0]).toMatchObject({ name: 'restored-box', snapshot: 'snap-ref' });
  });

  it('refuses to snapshot a running ephemeral sandbox instead of stopping it away', async () => {
    const provider = microsandbox({ backend: 'local' });
    const sandbox = await provider.sandbox.create({ name: 'ephemeral-box' });
    const handle = mock.handles.get('ephemeral-box');
    handle.configValue.lifecycle = { ephemeral: true };

    await expect(provider.snapshot!.create(sandbox.sandboxId)).rejects.toThrow(/ephemeral.*ephemeral: false/);
    expect(handle.status).toBe('running');
    expect(mock.stopAttempts).toBe(0);
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

  it('streams large file writes in chunks under the relay frame limit', async () => {
    const sandbox = await microsandbox({ backend: 'local' }).sandbox.create({ name: 'fs-large-box' });
    const content = 'x'.repeat(1024 * 1024 + 7);
    await sandbox.filesystem.writeFile('/large.txt', content);

    const fsOps = (sandbox.getInstance() as any).sandbox.fsOps;
    const writes = fsOps.writes.filter((w: { path: string }) => w.path === '/large.txt');
    expect(writes.length).toBe(5);
    expect(Math.max(...writes.map((w: { bytes: number }) => w.bytes))).toBeLessThanOrEqual(256 * 1024);
    expect(await sandbox.filesystem.readFile('/large.txt')).toBe(content);
  });
});
