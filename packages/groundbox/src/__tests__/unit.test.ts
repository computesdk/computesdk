import { afterEach, describe, expect, it, vi } from 'vitest';
import { groundbox } from '../index';
import { ApiError, type FakeCall, fakeApi, sandbox } from './fake-api';

const ID = 'sbx_test0000000000';

/** A provider on a fake API, and an instance of it. */
async function setup(routes: Parameters<typeof fakeApi>[0] = {}, config: Parameters<typeof groundbox>[0] = {}) {
  const api = fakeApi({ 'POST /sandboxes': sandbox(), ...routes });
  const provider = groundbox({ apiKey: 'gbx_test', fetch: api.fetch, ...config });
  const instance = await provider.instances.create();
  return { api, provider, instance };
}

describe('groundbox config', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('reports a missing key on first use, with the setup steps', async () => {
    vi.stubEnv('GROUNDBOX_API_KEY', '');
    const api = fakeApi({});
    await expect(groundbox({ fetch: api.fetch }).instances.list()).rejects.toThrow(/GROUNDBOX_API_KEY/);
    expect(api.calls).toEqual([]);
  });

  it('reads the key and the API address from the environment', async () => {
    vi.stubEnv('GROUNDBOX_API_KEY', 'gbx_env');
    vi.stubEnv('GROUNDBOX_API_URL', 'https://api.example.test/v1');
    const api = fakeApi({ 'GET /sandboxes': { data: [], next_cursor: null } });
    await groundbox({ fetch: api.fetch }).instances.list();
    expect(api.last().headers.authorization).toBe('Bearer gbx_env');
    expect(vi.mocked(api.fetch).mock.calls[0]![0].toString()).toMatch(/^https:\/\/api\.example\.test\/v1\/sandboxes/);
  });

  it('prefers the config over the environment', async () => {
    vi.stubEnv('GROUNDBOX_API_KEY', 'gbx_env');
    const api = fakeApi({ 'GET /sandboxes': { data: [], next_cursor: null } });
    await groundbox({ apiKey: 'gbx_config', fetch: api.fetch }).instances.list();
    expect(api.last().headers.authorization).toBe('Bearer gbx_config');
  });
});

describe('groundbox instances', () => {
  it('creates with the API defaults when no option is given', async () => {
    const { api, instance } = await setup();
    expect(api.last()).toMatchObject({ method: 'POST', path: '/sandboxes', body: {} });
    expect(instance.instanceId).toBe(ID);
    expect(instance.provider).toBe('groundbox');
  });

  it('maps create options to the sandbox spec', async () => {
    const { api, provider } = await setup();
    await provider.instances.create({
      timeout: 90_001,
      envs: { TOKEN: 'x' },
      metadata: { job: 'build', attempt: 2 },
      name: 'worker',
      templateId: 'python-ml:3',
      cpus: 4,
      memory_gb: 8,
      disk_gb: 40,
      allow_hosts: ['github.com'],
      volumes: [{ volume: { id: 'vol_abc12345' }, mountPath: '/data', readOnly: true }],
    });
    expect(api.last().body).toEqual({
      user: 'root',
      cpus: 4,
      memory_gb: 8,
      disk_gb: 40,
      timeout_minutes: 2,
      env: { TOKEN: 'x' },
      metadata: { job: 'build', attempt: '2', name: 'worker' },
      template: 'python-ml:3',
      allow_hosts: ['github.com'],
      volumes: [{ volume: 'vol_abc12345', path: '/data', read_only: true }],
    });
  });

  it('starts from an image, waiting while it is turned into a disk', async () => {
    const states = ['queued', 'running'];
    const api = fakeApi({ 'POST /sandboxes': sandbox({ status: 'queued' }), 'GET /sandboxes/:id': () => sandbox({ status: states.shift() }) });
    const provider = groundbox({ apiKey: 'gbx_test', fetch: api.fetch });
    vi.useFakeTimers();
    try {
      const created = provider.instances.create({ image: 'python:3.12-slim' });
      await vi.advanceTimersByTimeAsync(5000);
      expect((await created).instanceId).toBe(ID);
    } finally {
      vi.useRealTimers();
    }
    expect(api.calls[0]!.body).toEqual({ image: 'python:3.12-slim', user: 'root' });
    expect(api.calls.filter((call) => call.method === 'GET')).toHaveLength(2);
  });

  it('destroys a sandbox whose image could not be used, and says why', async () => {
    const api = fakeApi({
      'POST /sandboxes': sandbox({ status: 'queued' }),
      'GET /sandboxes/:id': sandbox({ status: 'failed', error: 'The image has no /bin/sh' }),
      'DELETE /sandboxes/:id': sandbox({ status: 'stopped' }),
    });
    const provider = groundbox({ apiKey: 'gbx_test', fetch: api.fetch });
    vi.useFakeTimers();
    try {
      const created = provider.instances.create({ image: 'scratch' });
      const failure = expect(created).rejects.toThrow(/failed \(The image has no \/bin\/sh\)/);
      await vi.advanceTimersByTimeAsync(5000);
      await failure;
    } finally {
      vi.useRealTimers();
    }
    expect(api.last().method).toBe('DELETE');
  });

  it('stops waiting when the create is aborted, and deletes the sandbox', async () => {
    const api = fakeApi({
      'POST /sandboxes': sandbox({ status: 'queued' }),
      'GET /sandboxes/:id': sandbox({ status: 'queued' }),
      'DELETE /sandboxes/:id': sandbox({ status: 'stopped' }),
    });
    const provider = groundbox({ apiKey: 'gbx_test', fetch: api.fetch });
    const controller = new AbortController();
    vi.useFakeTimers();
    try {
      const created = provider.instances.create({ image: 'python:3.12-slim', signal: controller.signal });
      const failure = expect(created).rejects.toMatchObject({ name: 'AbortError' });
      await vi.advanceTimersByTimeAsync(5000);
      controller.abort();
      await vi.advanceTimersByTimeAsync(0);
      await failure;
    } finally {
      vi.useRealTimers();
    }
    const polls = api.calls.filter((call) => call.method === 'GET').length;
    expect(polls).toBeGreaterThan(0);
    expect(api.last()).toMatchObject({ method: 'DELETE', path: `/sandboxes/${ID}` });
  });

  it.each(['stopping', 'shutting_down', 'shut_down'])('stops waiting for a sandbox that is %s', async (status) => {
    const api = fakeApi({
      'POST /sandboxes': sandbox({ status: 'starting' }),
      'GET /sandboxes/:id': sandbox({ status }),
      'DELETE /sandboxes/:id': sandbox({ status: 'stopped' }),
    });
    const provider = groundbox({ apiKey: 'gbx_test', fetch: api.fetch });
    vi.useFakeTimers();
    try {
      const created = provider.instances.create({ snapshotId: 'snap_abc12345' });
      const failure = expect(created).rejects.toThrow(new RegExp(`is ${status}`));
      await vi.advanceTimersByTimeAsync(2000);
      await failure;
    } finally {
      vi.useRealTimers();
    }
    expect(api.calls.filter((call) => call.method === 'GET')).toHaveLength(1);
    expect(api.last().method).toBe('DELETE');
  });

  it('runs commands as root unless asked for the image user', async () => {
    const { api, provider } = await setup();
    await provider.instances.create({});
    expect(api.last().body).toEqual({ user: 'root' });
    await provider.instances.create({ user: 'runner' } as never);
    expect(api.last().body).toEqual({ user: 'runner' });
  });

  it('passes egress deny lists, secrets and the timeout action through', async () => {
    const { api, provider } = await setup();
    await provider.instances.create({ deny_hosts: ['*.example.com'], secrets: ['NPM_TOKEN'], env_from_secrets: { TOKEN: 'GH_TOKEN' }, on_timeout: 'stop' });
    expect(api.last().body).toEqual({ deny_hosts: ['*.example.com'], secrets: ['NPM_TOKEN'], env_from_secrets: { TOKEN: 'GH_TOKEN' }, on_timeout: 'stop', user: 'root' });
  });

  it('starts from a kept snapshot, waiting while it is restored', async () => {
    const states = ['starting', 'running'];
    const api = fakeApi({ 'POST /sandboxes': sandbox({ status: 'queued' }), 'GET /sandboxes/:id': () => sandbox({ status: states.shift() }) });
    const provider = groundbox({ apiKey: 'gbx_test', fetch: api.fetch });
    vi.useFakeTimers();
    try {
      const created = provider.instances.create({ snapshotId: 'snap_abc12345', sizeClass: 'xs' });
      await vi.advanceTimersByTimeAsync(5000);
      expect((await created).instanceId).toBe(ID);
    } finally {
      vi.useRealTimers();
    }
    expect(api.calls[0]!.body).toEqual({ snapshot_id: 'snap_abc12345', cpus: 1, memory_gb: 1 });
    // A sandbox from a snapshot keeps its source's user: none is sent unless asked for.
  });

  it('does not wait for a flex sandbox that is queued for room', async () => {
    const api = fakeApi({ 'POST /sandboxes': sandbox({ status: 'queued', flex: true }) });
    expect((await groundbox({ apiKey: 'gbx_test', fetch: api.fetch }).instances.create({ flex: true })).instanceId).toBe(ID);
    expect(api.calls).toHaveLength(1);
  });

  it.each([
    { snapshotId: 'snap_abc12345', image: 'node:22' },
    { snapshotId: 'snap_abc12345', templateId: 'python-ml' },
    { image: 'node:22', templateId: 'python-ml' },
  ])('refuses %o before any request', async (options) => {
    const api = fakeApi({ 'POST /sandboxes': sandbox() });
    await expect(groundbox({ apiKey: 'gbx_test', fetch: api.fetch }).instances.create(options)).rejects.toThrow(/Groundbox/);
    expect(api.calls).toEqual([]);
  });

  it('finds a live sandbox, and answers null for one that is gone', async () => {
    const answers = [sandbox(), sandbox({ status: 'stopped', stop_reason: 'deleted' }), new ApiError(404, 'not_found', 'No sandbox')];
    const { provider } = await setup({ 'GET /sandboxes/:id': () => answers.shift() });
    expect((await provider.instances.getById(ID))?.instanceId).toBe(ID);
    expect(await provider.instances.getById(ID)).toBeNull();
    expect(await provider.instances.getById(ID)).toBeNull();
  });

  it('lists live sandboxes in one filtered listing, through every page', async () => {
    const { api, provider } = await setup({
      'GET /sandboxes': (call: FakeCall) => (call.query.cursor ? { data: [sandbox({ id: 'sbx_second00000000' })], next_cursor: null } : { data: [sandbox()], next_cursor: 'next' }),
    });
    expect((await provider.instances.list()).map((instance) => instance.instanceId)).toEqual([ID, 'sbx_second00000000']);
    const lists = api.calls.filter((call) => call.path === '/sandboxes' && call.method === 'GET');
    expect(lists.map((call) => call.query)).toEqual([{ limit: '200', live: 'true' }, { limit: '200', live: 'true', cursor: 'next' }]);
  });

  it('destroys, and treats a sandbox that is already gone as destroyed', async () => {
    const answers: unknown[] = [sandbox({ status: 'stopped' }), new ApiError(404, 'not_found', 'No sandbox')];
    const { api, provider } = await setup({ 'DELETE /sandboxes/:id': () => answers.shift() });
    await provider.instances.destroy(ID);
    await provider.instances.destroy(ID);
    expect(api.calls.filter((call) => call.method === 'DELETE')).toHaveLength(2);
  });

  it('keeps its own groundbox metadata key over a user label of the same name', async () => {
    const { instance } = await setup({ 'GET /sandboxes/:id': sandbox({ metadata: { groundbox: 'mine', job: 'build' } }) });
    const { metadata } = await instance.getInfo();
    expect(metadata?.job).toBe('build');
    expect(metadata?.groundbox).toMatchObject({ status: 'running', cpus: 2 });
  });

  it('reports status, lifetime and the booted size', async () => {
    const { instance } = await setup({ 'GET /sandboxes/:id': sandbox({ status: 'paused', metadata: { job: 'build' } }) });
    expect(await instance.getInfo()).toEqual({
      id: ID,
      provider: 'groundbox',
      status: 'stopped',
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      timeout: 3_600_000,
      metadata: {
        job: 'build',
        groundbox: { status: 'paused', cpus: 2, memoryGb: 4, diskGb: 20, booted: { cpus: 2, memoryMiB: 3920 }, expiresAt: '2026-01-01T01:00:00.000Z' },
      },
    });
  });

  it('gives the native handle', async () => {
    const { instance } = await setup();
    const native = instance.getInstance();
    expect(native.id).toBe(ID);
    expect(typeof native.client.fork_sandbox).toBe('function');
  });
});

describe('groundbox commands', () => {
  const exec = { exit_code: 0, stdout: 'out', stderr: 'err', duration_ms: 3, timed_out: false };

  it('runs a command with cwd, env and a timeout in whole seconds', async () => {
    const { api, instance } = await setup({ 'POST /sandboxes/:id/exec': exec });
    const result = await instance.runCommand('echo hi', { cwd: '/tmp', env: { A: 'b' }, timeout: 1500 });
    expect(api.last().body).toEqual({ cmd: 'echo hi', cwd: '/tmp', env: { A: 'b' }, timeout_s: 2 });
    expect(result).toMatchObject({ stdout: 'out', stderr: 'err', exitCode: 0 });
  });

  it('uses the 60 second default and the one hour maximum', async () => {
    const { api, instance } = await setup({ 'POST /sandboxes/:id/exec': exec });
    await instance.runCommand('true');
    expect(api.last().body).toEqual({ cmd: 'true', timeout_s: 60 });
    await instance.runCommand('true', { timeout: 24 * 3_600_000 });
    expect(api.last().body).toEqual({ cmd: 'true', timeout_s: 3600 });
  });

  it('starts a background command with nobody waiting for it', async () => {
    const { api, instance } = await setup({ 'POST /sandboxes/:id/commands': { id: 'ex_0123456789abcdef', state: 'running' } });
    const result = await instance.runCommand('sleep 600', { background: true, cwd: '/tmp', env: { A: 'b' }, timeout: 7_200_000 });
    expect(api.last()).toMatchObject({ method: 'POST', path: `/sandboxes/${ID}/commands`, body: { cmd: 'sleep 600', cwd: '/tmp', env: { A: 'b' }, timeout_s: 7200 } });
    expect(api.last().headers.authorization).toBe('Bearer gbx_test');
    expect(result).toMatchObject({ stdout: '', stderr: '', exitCode: 0 });
  });

  it('never reports a command killed at its timeout as a success', async () => {
    const answers = [{ ...exec, exit_code: 137, timed_out: true }, { ...exec, exit_code: 0, timed_out: true }];
    const { instance } = await setup({ 'POST /sandboxes/:id/exec': () => answers.shift() });
    expect((await instance.runCommand('sleep 9', { timeout: 1000 })).exitCode).toBe(137);
    expect((await instance.runCommand('sleep 9', { timeout: 1000 })).exitCode).toBe(124);
  });

  it('streams output over the exec stream and keeps what it streamed', async () => {
    const sent: unknown[] = [];
    class Socket extends EventTarget {
      readyState = 0;
      constructor(readonly url: string, readonly init: { headers: Record<string, string> }) {
        super();
        queueMicrotask(() => {
          this.readyState = 1;
          this.dispatchEvent(new Event('open'));
        });
      }
      send(text: string) {
        const message = JSON.parse(text) as { type: string };
        sent.push({ url: this.url, authorization: this.init.headers.authorization, ...message });
        if (message.type !== 'start') return;
        for (const reply of [
          { type: 'started', exec_id: 'ex_0123456789abcdef' },
          { type: 'stdout', data: 'tick 1\n', seq: 7 },
          { type: 'stderr', data: 'warn\n', seq: 12 },
          { type: 'stdout', data: 'tick 2\n', seq: 19 },
          { type: 'exit', exit_code: 3, duration_ms: 20, timed_out: false },
        ]) {
          this.dispatchEvent(Object.assign(new Event('message'), { data: JSON.stringify(reply) }));
        }
      }
      close() {}
    }
    const { instance } = await setup({}, { WebSocket: Socket as unknown as typeof WebSocket });
    const out: string[] = [];
    const err: string[] = [];
    const result = await instance.runCommand('ticks', { timeout: 5000, cwd: '/tmp', onStdout: (text) => out.push(text), onStderr: (text) => err.push(text) });
    expect(sent).toEqual([
      { url: `wss://api.groundbox.dev/v1/sandboxes/${ID}/exec/stream`, authorization: 'Bearer gbx_test', type: 'start', cmd: 'ticks', cwd: '/tmp', timeout_s: 5, resumable: true },
    ]);
    expect(out).toEqual(['tick 1\n', 'tick 2\n']);
    expect(err).toEqual(['warn\n']);
    expect(result).toMatchObject({ stdout: 'tick 1\ntick 2\n', stderr: 'warn\n', exitCode: 3 });
    expect(instance.processRuntime).toEqual({ streaming: 'native', processes: 'native' });
  });

  it('runs a process on the exec stream, with stdin, output so far, and a signal on kill', async () => {
    const sent: Array<Record<string, unknown>> = [];
    let socket!: Socket;
    class Socket extends EventTarget {
      readyState = 0;
      constructor() {
        super();
        socket = this; // eslint-disable-line @typescript-eslint/no-this-alias
        queueMicrotask(() => {
          this.readyState = 1;
          this.dispatchEvent(new Event('open'));
        });
      }
      reply(message: unknown) {
        this.dispatchEvent(Object.assign(new Event('message'), { data: JSON.stringify(message) }));
      }
      send(text: string) {
        const message = JSON.parse(text) as { type: string; data?: string };
        sent.push(message);
        if (message.type === 'start') this.reply({ type: 'started', exec_id: 'ex_0123456789abcdef' });
        if (message.type === 'stdin' && message.data !== undefined) this.reply({ type: 'stdout', data: message.data, seq: 1 });
      }
      close() {}
    }
    const { api, instance } = await setup(
      { 'POST /sandboxes/:id/commands/:id/kill': () => (socket.reply({ type: 'exit', exit_code: 137, duration_ms: 9, timed_out: false }), { id: 'ex_0123456789abcdef' }) },
      { WebSocket: Socket as unknown as typeof WebSocket },
    );
    const exits: unknown[] = [];
    const process = await instance.startProcess('cat', { stdin: true, cwd: '/tmp', onExit: (result) => exits.push(result) });
    expect(process).toMatchObject({ jobId: 'ex_0123456789abcdef', pid: null, runtime: 'native' });
    expect(sent[0]).toEqual({ type: 'start', cmd: 'cat', cwd: '/tmp', timeout_s: 30 * 24 * 3600, stdin: true, resumable: true });

    await process.write('hello\n');
    // Bytes go through as they are, UTF-8 or not.
    await process.write(new Uint8Array([0xff, 0xfe]));
    expect(sent).toContainEqual({ type: 'stdin', data_base64: '//4=' });
    expect(await process.status()).toEqual({ status: 'running', exitCode: null, signal: null, stdout: 'hello\n', stderr: '' });
    await expect(process.wait({ timeout: 10 })).rejects.toThrow(/did not exit within 10 ms/);

    await process.kill('SIGTERM');
    expect(api.last()).toMatchObject({ path: `/sandboxes/${ID}/commands/ex_0123456789abcdef/kill`, body: { signal: 'SIGTERM' } });
    expect(await process.wait()).toMatchObject({ stdout: 'hello\n', exitCode: 137, signal: 'SIGTERM' });
    expect(exits).toEqual([{ exitCode: 137, signal: 'SIGTERM' }]);
    await expect(process.write('late')).rejects.toThrow(/exited/);
  });

  /** A process on a fake exec stream; `exit` ends it. */
  async function processOn(routes: Parameters<typeof fakeApi>[0]) {
    let socket!: Socket;
    class Socket extends EventTarget {
      readyState = 0;
      constructor() {
        super();
        socket = this; // eslint-disable-line @typescript-eslint/no-this-alias
        queueMicrotask(() => {
          this.readyState = 1;
          this.dispatchEvent(new Event('open'));
        });
      }
      send(text: string) {
        if ((JSON.parse(text) as { type: string }).type === 'start') this.reply({ type: 'started', exec_id: 'ex_0123456789abcdef' });
      }
      reply(message: unknown) {
        this.dispatchEvent(Object.assign(new Event('message'), { data: JSON.stringify(message) }));
      }
      close() {}
    }
    const { api, instance } = await setup(routes, { WebSocket: Socket as unknown as typeof WebSocket });
    const process = await instance.startProcess('sleep 600', {});
    const exit = (code: number) => socket.reply({ type: 'exit', exit_code: code, duration_ms: 9, timed_out: false });
    return { api, process, exit };
  }

  it('refuses a signal the API does not send, before any request', async () => {
    const { api, process } = await processOn({});
    const before = api.calls.length;
    await expect(process.kill('SIGSTOP')).rejects.toThrow(/SIGSTOP/);
    expect(api.calls).toHaveLength(before);
  });

  it.each([
    [404, 'not_found'],
    [409, 'conflict'],
  ])('treats a kill that answers %i because the process just exited as done', async (status, code) => {
    let exit!: (code: number) => void;
    const ready = await processOn({
      'POST /sandboxes/:id/commands/:id/kill': () => {
        setTimeout(() => exit(0), 5);
        return new ApiError(status, code, 'No such command');
      },
    });
    exit = ready.exit;
    await ready.process.kill('SIGTERM');
    expect(await ready.process.wait()).toMatchObject({ exitCode: 0, signal: null });
  });

  it('does not report a signal after a kill that failed', async () => {
    const { process, exit } = await processOn({ 'POST /sandboxes/:id/commands/:id/kill': new ApiError(500, 'internal', 'The box did not answer') });
    await expect(process.kill('SIGTERM')).rejects.toThrow(/did not answer/);
    exit(1);
    expect(await process.wait()).toMatchObject({ exitCode: 1, signal: null });
  });
});

describe('groundbox previews', () => {
  const preview = (fields: Record<string, unknown>) => ({ id: 'p', sandbox_id: ID, port: 3000, public: false, url: 'https://abc123-3000.previews.example/', share_url: null, ...fields });

  it('returns a private preview as its share link by default', async () => {
    const { api, instance } = await setup({ 'POST /sandboxes/:id/previews': preview({ share_url: 'https://abc123-3000.previews.example/?gb_token=t' }) });
    expect(await instance.getUrl({ port: 3000 })).toBe('https://abc123-3000.previews.example/?gb_token=t');
    expect(api.last().body).toEqual({ port: 3000 });
  });

  it('makes a public preview when configured, and returns its plain URL', async () => {
    const { api, instance } = await setup({ 'POST /sandboxes/:id/previews': preview({ public: true }) }, { previews: 'public' });
    expect(await instance.getUrl({ port: 3000 })).toBe('https://abc123-3000.previews.example');
    expect(api.last().body).toEqual({ port: 3000, public: true });
    expect(await instance.getUrl({ port: 3000, protocol: 'wss' })).toBe('wss://abc123-3000.previews.example');
  });

  it('refuses a protocol previews do not serve', async () => {
    const { instance } = await setup();
    await expect(instance.getUrl({ port: 22, protocol: 'ssh' })).rejects.toThrow(/not supported/);
  });
});

describe('groundbox pause, resume and lifetime', () => {
  it('pauses and resumes, waiting for the sandbox to get there', async () => {
    const states = ['pausing', 'paused'];
    const { api, provider, instance } = await setup({
      'POST /sandboxes/:id/pause': sandbox({ status: 'pausing' }),
      'GET /sandboxes/:id': () => sandbox({ status: states.shift() }),
      'POST /sandboxes/:id/resume': sandbox({ status: 'running' }),
    });
    expect(provider.instances.pause).toEqual({ memory: true });
    await instance.pause!();
    expect(api.calls.filter((call) => call.method === 'GET')).toHaveLength(2);
    await instance.resume!();
    expect(api.last()).toMatchObject({ method: 'POST', path: `/sandboxes/${ID}/resume` });
  });

  it('fails a pause when the sandbox ended meanwhile', async () => {
    const { instance } = await setup({ 'POST /sandboxes/:id/pause': sandbox({ status: 'stopped', stop_reason: 'timeout' }) });
    await expect(instance.pause!()).rejects.toThrow(/stopped \(timeout\)/);
  });

  it('declares its lifetime and renews it in whole minutes', async () => {
    const { api, provider, instance } = await setup({ 'PATCH /sandboxes/:id': sandbox() });
    expect(provider.instances.lifetime).toEqual({ defaultMs: 3_600_000, maxMs: 30 * 86_400_000, extendable: true });
    await instance.extendLifetime!(600_000);
    expect(api.last().body).toEqual({ timeout_minutes: 10 });
    await instance.extendLifetime!(60 * 86_400_000);
    expect(api.last().body).toEqual({ timeout_minutes: 43_200 });
  });
});

describe('groundbox filesystem', () => {
  it('reads and writes through the files API', async () => {
    const { api, instance } = await setup({ 'PUT /sandboxes/:id/files': { path: '/tmp/a.txt', size_bytes: 2 }, 'GET /sandboxes/:id/files': 'hi' });
    await instance.filesystem.writeFile('/tmp/a.txt', 'hi');
    expect(api.last()).toMatchObject({ method: 'PUT', query: { path: '/tmp/a.txt' }, body: 'hi' });
    expect(await instance.filesystem.readFile('/tmp/a.txt')).toBe('hi');
    expect(api.last()).toMatchObject({ method: 'GET', query: { path: '/tmp/a.txt' } });
  });

  it('fails to read a file that is not there', async () => {
    const { instance } = await setup({ 'GET /sandboxes/:id/files': new ApiError(404, 'not_found', 'No such file or folder: /nope') });
    await expect(instance.filesystem.readFile('/nope')).rejects.toThrow(/No such file/);
  });

  it('lists a folder', async () => {
    const entry = (name: string, type: string) => ({ name, path: `/tmp/${name}`, type, size_bytes: 5, modified_at: '2026-01-01T00:00:00.000Z' });
    const { api, instance } = await setup({ 'GET /sandboxes/:id/files': { dir: '/tmp', entries: [entry('a.txt', 'file'), entry('sub', 'dir'), entry('link', 'symlink')] } });
    expect(await instance.filesystem.readdir('/tmp')).toEqual([
      { name: 'a.txt', type: 'file', size: 5, modified: new Date('2026-01-01T00:00:00.000Z') },
      { name: 'sub', type: 'directory', size: 5, modified: new Date('2026-01-01T00:00:00.000Z') },
      { name: 'link', type: 'file', size: 5, modified: new Date('2026-01-01T00:00:00.000Z') },
    ]);
    expect(api.last().query).toEqual({ dir: '/tmp' });
  });

  it('makes, checks and removes paths through the files API', async () => {
    const entry = { name: 'dir', path: '/tmp/my dir', type: 'dir', size_bytes: 0, modified_at: '2026-01-01T00:00:00.000Z' };
    const stats: unknown[] = [entry, new ApiError(404, 'not_found', 'No such file or folder: /tmp/my dir')];
    const { api, instance } = await setup({
      'POST /sandboxes/:id/files/mkdir': { path: '/tmp/my dir', created: true },
      'GET /sandboxes/:id/files/stat': () => stats.shift(),
      'GET /sandboxes/:id': sandbox(),
      'DELETE /sandboxes/:id/files': { path: '/tmp/my dir', deleted: true },
    });
    const path = '/tmp/my dir';
    await instance.filesystem.mkdir(path);
    expect(api.last()).toMatchObject({ method: 'POST', path: `/sandboxes/${ID}/files/mkdir`, query: { path } });
    expect(await instance.filesystem.exists(path)).toBe(true);
    expect(await instance.filesystem.exists(path)).toBe(false);
    await instance.filesystem.remove(path);
    expect(api.last()).toMatchObject({ method: 'DELETE', path: `/sandboxes/${ID}/files`, query: { path, recursive: 'true' } });
  });

  it('tells a missing path from a missing sandbox by the sandbox, not by the message', async () => {
    // However the 404 is worded, a path is "not there" only in a sandbox that is.
    const stat = new ApiError(404, 'not_found', 'Nothing at /tmp/x');
    const sandboxes: unknown[] = [sandbox(), new ApiError(404, 'not_found', 'No sandbox sbx_test0000000000'), sandbox({ status: 'stopped', stop_reason: 'deleted' })];
    const { instance } = await setup({ 'GET /sandboxes/:id/files/stat': stat, 'GET /sandboxes/:id': () => sandboxes.shift() });
    expect(await instance.filesystem.exists('/tmp/x')).toBe(false);
    await expect(instance.filesystem.exists('/tmp/x')).rejects.toThrow(/No sandbox/);
    await expect(instance.filesystem.exists('/tmp/x')).rejects.toThrow(/Nothing at/);
  });

  it('fails exists on any other error', async () => {
    const { api, instance } = await setup({ 'GET /sandboxes/:id/files/stat': new ApiError(409, 'conflict', 'The sandbox is paused') });
    await expect(instance.filesystem.exists('/tmp/x')).rejects.toThrow(/paused/);
    expect(api.last().path).toBe(`/sandboxes/${ID}/files/stat`);
  });

  it('fails mkdir when a file is in the way', async () => {
    const { instance } = await setup({ 'POST /sandboxes/:id/files/mkdir': new ApiError(409, 'conflict', '/tmp/a.txt is a file') });
    await expect(instance.filesystem.mkdir('/tmp/a.txt')).rejects.toThrow(/is a file/);
  });
});

describe('groundbox templates and volumes', () => {
  const volume = (fields: Record<string, unknown> = {}) => ({ id: 'vol_abc12345', name: 'data', size_gb: 2, status: 'ready', attachments: [], cost_micros: 0, created_at: '2026-01-01T00:00:00.000Z', deleted_at: null, ...fields });

  it('creates, lists and deletes templates', async () => {
    const template = { id: 'tpl_abc12345', name: 'python-ml', version: null, status: 'building' };
    const { api, provider } = await setup({ 'POST /templates': template, 'GET /templates': { data: [template], next_cursor: null }, 'DELETE /templates/:id': { ok: true } });
    expect(await provider.template!.create({ name: 'python-ml', image: 'python:3.12-slim', pip: ['numpy'], description: 'not sent' } as never)).toEqual(template);
    expect(api.last().body).toEqual({ name: 'python-ml', image: 'python:3.12-slim', pip: ['numpy'] });
    expect(await provider.template!.list()).toEqual([template]);
    await provider.template!.delete('python-ml');
    expect(api.last()).toMatchObject({ method: 'DELETE', path: '/templates/python-ml' });
  });

  it('creates a volume in whole GB, rounded up', async () => {
    const { api, provider } = await setup({ 'POST /volumes': volume() });
    const made = await provider.volume!.create({ name: 'data', sizeBytes: 1.5 * 2 ** 30 });
    expect(api.last().body).toEqual({ name: 'data', size_gb: 2 });
    expect(made).toMatchObject({ id: 'vol_abc12345', name: 'data', sizeGb: 2, status: 'ready' });
    // No size: the default, 10 GB.
    await provider.volume!.create({ name: 'scratch' });
    expect(api.last().body).toEqual({ name: 'scratch', size_gb: 10 });
    await expect(provider.volume!.create({ name: 'data', sizeBytes: -1 })).rejects.toThrow(/size/);
  });

  it('gets, lists and deletes volumes', async () => {
    const answers: unknown[] = [volume(), volume({ status: 'deleting' }), volume({ status: 'deleted' }), new ApiError(404, 'not_found', 'No volume')];
    const { api, provider } = await setup({
      'GET /volumes/:id': () => answers.shift(),
      'GET /volumes': { data: [volume({ id: 'vol_going000', status: 'deleting' }), volume(), volume({ id: 'vol_gone0000', status: 'deleted' })], next_cursor: null },
      'DELETE /volumes/:id': volume({ status: 'deleting' }),
    });
    expect((await provider.volume!.get('data'))?.id).toBe('vol_abc12345');
    expect(await provider.volume!.get('data')).toBeNull();
    expect(await provider.volume!.get('data')).toBeNull();
    expect(await provider.volume!.get('data')).toBeNull();
    expect((await provider.volume!.list!()).map((item) => item.id)).toEqual(['vol_abc12345']);
    expect((await provider.volume!.list!({ limit: 1 })).map((item) => item.id)).toEqual(['vol_abc12345']);
    await provider.volume!.delete('data');
    expect(api.last()).toMatchObject({ method: 'DELETE', path: '/volumes/data' });
  });
});

describe('groundbox snapshots', () => {
  const snapshot = (fields: Record<string, unknown> = {}) => ({
    id: 'snap_abc12345',
    status: 'creating',
    source_sandbox_id: ID,
    source_snapshot_id: null,
    label: null,
    cpus: 1,
    memory_gb: 1,
    disk_gb: 20,
    memory: true,
    size_bytes: 0,
    cost_micros: 0,
    taken_at: null,
    created_at: '2026-01-01T00:00:00.000Z',
    last_used_at: null,
    expires_at: null,
    deleted_at: null,
    error: null,
    ...fields,
  });

  it('declares what a kept snapshot holds', () => {
    const provider = groundbox({ apiKey: 'gbx_test', fetch: fakeApi({}).fetch });
    expect(provider.snapshot!.capabilities).toEqual({ scope: 'rootfs', memory: true, destroysSource: false, source: 'kept', fork: true, readiness: 'eventual' });
  });

  it('keeps a snapshot of a sandbox, named by its label', async () => {
    const api = fakeApi({ 'POST /snapshots': snapshot({ label: 'before-migration' }) });
    const provider = groundbox({ apiKey: 'gbx_test', fetch: api.fetch });
    const kept = await provider.snapshot!.create(ID, { name: 'before-migration', metadata: { a: 'b' } });
    expect(api.last()).toMatchObject({ method: 'POST', path: '/snapshots', body: { sandbox_id: ID, label: 'before-migration' } });
    expect(api.last().headers.authorization).toBe('Bearer gbx_test');
    expect(kept).toMatchObject({ id: 'snap_abc12345', provider: 'groundbox', status: 'creating', sourceInstanceId: ID, name: 'before-migration' });
    // It answers while the snapshot is still being made: nothing polls it.
    expect(api.calls).toHaveLength(1);
  });

  it('waits until a snapshot is ready, and says why one failed', async () => {
    const answers = [snapshot(), snapshot({ status: 'ready' }), snapshot({ status: 'failed', error: 'The box was lost' })];
    const api = fakeApi({ 'GET /snapshots/:id': () => answers.shift() });
    const provider = groundbox({ apiKey: 'gbx_test', fetch: api.fetch });
    vi.useFakeTimers();
    try {
      const ready = provider.snapshot!.waitUntilReady!('snap_abc12345');
      await vi.advanceTimersByTimeAsync(2000);
      await ready;
    } finally {
      vi.useRealTimers();
    }
    await expect(provider.snapshot!.waitUntilReady!('snap_abc12345')).rejects.toThrow(/failed \(The box was lost\)/);
  });

  it('lists the snapshots of one sandbox, through every page', async () => {
    const api = fakeApi({
      'GET /snapshots': (call: FakeCall) =>
        call.query.cursor ? { data: [snapshot({ id: 'snap_second0000', status: 'ready' })], next_cursor: null } : { data: [snapshot()], next_cursor: 'next' },
    });
    const provider = groundbox({ apiKey: 'gbx_test', fetch: api.fetch });
    expect((await provider.snapshot!.list({ instanceId: ID })).map((each) => each.id)).toEqual(['snap_abc12345', 'snap_second0000']);
    expect(api.calls.map((call) => call.query)).toEqual([
      { limit: '200', sandbox_id: ID },
      { limit: '200', sandbox_id: ID, cursor: 'next' },
    ]);
  });

  it('applies limit after leaving out deleted snapshots', async () => {
    const api = fakeApi({
      'GET /snapshots': (call: FakeCall) =>
        call.query.cursor
          ? { data: [snapshot({ id: 'snap_live0001', status: 'ready' }), snapshot({ id: 'snap_live0002', status: 'ready' }), snapshot({ id: 'snap_live0003' })], next_cursor: 'more' }
          : { data: [snapshot({ id: 'snap_gone0001', status: 'deleted' }), snapshot({ id: 'snap_gone0002', status: 'deleted' })], next_cursor: 'next' },
    });
    const provider = groundbox({ apiKey: 'gbx_test', fetch: api.fetch });
    expect((await provider.snapshot!.list({ limit: 2 })).map((each) => each.id)).toEqual(['snap_live0001', 'snap_live0002']);
    // It reads on only until it has enough.
    expect(api.calls).toHaveLength(2);
  });

  it('deletes, retrying one still being made, and treats one that is gone as deleted', async () => {
    const answers: unknown[] = [new ApiError(409, 'conflict', 'Snapshot snap_abc12345 is still being made'), snapshot({ status: 'deleted' }), new ApiError(404, 'not_found', 'No snapshot')];
    const api = fakeApi({ 'DELETE /snapshots/:id': () => answers.shift() });
    const provider = groundbox({ apiKey: 'gbx_test', fetch: api.fetch });
    vi.useFakeTimers();
    try {
      const deleted = provider.snapshot!.delete('snap_abc12345');
      await vi.advanceTimersByTimeAsync(2500);
      await deleted;
    } finally {
      vi.useRealTimers();
    }
    await provider.snapshot!.delete('snap_abc12345');
    expect(api.calls.map((call) => `${call.method} ${call.path}`)).toEqual(Array(3).fill('DELETE /snapshots/snap_abc12345'));
  });
});
