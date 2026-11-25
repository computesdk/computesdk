import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { infoStatus, orble, ORBLE_SIZES } from '../index';

// Raw file transfers go through node:https; route them to the stubbed fetch, so every request is recorded alike.
vi.mock('node:https', () => ({
  request: (url: string, opts: { method: string; headers: Record<string, string> }, cb: (res: EventEmitter & { statusCode?: number }) => void) => {
    const req = new EventEmitter() as EventEmitter & { end: (body?: Buffer) => void };
    req.end = (body?: Buffer) => {
      (globalThis.fetch as typeof fetch)(url, { method: opts.method, headers: opts.headers, body: body as BodyInit | undefined })
        .then(async (r) => {
          const res = Object.assign(new EventEmitter(), { statusCode: r.status });
          cb(res);
          res.emit('data', Buffer.from(await r.arrayBuffer()));
          res.emit('end');
        })
        .catch((e) => req.emit('error', e));
    };
    return req;
  },
}));

type Call = { url: string; method: string; body?: unknown };

/** Mocks fetch with one response per call, in order, and records each request. */
function mockFetch(responses: Array<{ status?: number; body?: unknown; raw?: string }>) {
  const calls: Call[] = [];
  const queue = [...responses];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
    const raw = init.body;
    calls.push({ url, method: init.method ?? 'GET', body: typeof raw === 'string' ? JSON.parse(raw) : raw });
    const next = queue.shift() ?? { status: 200, body: {} };
    const status = next.status ?? 200;
    if (next.raw !== undefined) return new Response(next.raw, { status });
    return new Response(next.body === undefined ? '' : JSON.stringify(next.body), { status });
  }));
  return calls;
}

const box = { name: 'k7f2', hostname: 'k7f2.you.orble.tech', state: 'running', vcpus: 8, mem_mib: 16384, disk_gib: 64, created_at: '2026-11-20T12:00:00Z' };
const config = { apiKey: 'orble_test', baseUrl: 'https://orble.example' };

// The unit tests assume the default user, whatever ORBLE_USER says in the shell that runs them.
beforeEach(() => { vi.stubEnv('ORBLE_USER', ''); });
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe('orble provider', () => {
  it('maps standard sizes onto Orble shapes', () => {
    expect(ORBLE_SIZES.md).toEqual({ size: 's', vcpus: 2, memoryMiB: 4096 });
    expect(ORBLE_SIZES.lg).toEqual({ size: 'm', vcpus: 4, memoryMiB: 8192 });
    expect(ORBLE_SIZES.xl).toEqual({ size: 'l', vcpus: 8, memoryMiB: 16384 });
    expect(ORBLE_SIZES.sm).toEqual({ size: 'micro', vcpus: 1, memoryMiB: 2048 });
    expect(ORBLE_SIZES.xs).toEqual({ size: 'micro', vcpus: 1, memoryMiB: 2048 });
  });

  it('keeps a box awake when asked, after creating it', async () => {
    const calls = mockFetch([{ body: box }, { body: { ...box, keep_awake: true } }]);
    await orble(config).instances.create({ size: 's', keepAwake: true } as any);
    expect(calls[0]).toMatchObject({ method: 'POST', body: { size: 's' } });
    expect(calls[1]).toMatchObject({ url: 'https://orble.example/v1/boxes/k7f2', method: 'PATCH', body: { keep_awake: true } });
  });

  it('deletes the box when keeping it awake fails', async () => {
    const calls = mockFetch([{ body: box }, { status: 500, raw: 'boom' }, { body: {} }]);
    await expect(orble(config).instances.create({ keepAwake: true } as any)).rejects.toThrow();
    expect(calls[2]).toMatchObject({ url: 'https://orble.example/v1/boxes/k7f2', method: 'DELETE' });
  });

  it('creates a micro box through the native size', async () => {
    const calls = mockFetch([{ body: { ...box, vcpus: 1, mem_mib: 2048 } }]);
    await orble(config).instances.create({ size: 'micro' } as any);
    expect(calls[0]).toMatchObject({ url: 'https://orble.example/v1/boxes', method: 'POST', body: { size: 'micro' } });
  });

  it('creates a box with the native size and a snapshot to start from', async () => {
    const calls = mockFetch([{ body: box }]);
    const sdk = orble(config);
    const instance = await sdk.instances.create({ size: 'l', snapshotId: 'task-env', name: 'bench' } as any);
    expect(instance.instanceId ?? (instance as any).id).toBe('k7f2');
    expect(calls[0]).toMatchObject({ url: 'https://orble.example/v1/boxes', method: 'POST', body: { size: 'l', from: 'task-env', name: 'bench' } });
  });

  it('polls a long command until it ends', async () => {
    const calls = mockFetch([
      { body: box },
      { body: { running: true, job: 'j1' } },
      { body: { running: true, job: 'j1' } },
      { body: { exit_code: 3, stdout: 'out', stderr: 'err' } },
    ]);
    const sdk = orble(config);
    const instance = await sdk.instances.create({ size: 'l' } as any);
    const result = await instance.runCommand('make', { timeout: 900_000, cwd: '/tmp', env: { CI: '1' } } as any);
    expect(result).toMatchObject({ exitCode: 3, stdout: 'out', stderr: 'err' });
    expect(calls[1].body).toEqual({ command: 'make', timeout_s: 600, cwd: '/tmp', env: { CI: '1' }, user: 'root' });
    expect(calls[2].body).toEqual({ job: 'j1' });
    expect(calls[3].body).toEqual({ job: 'j1' });
  });

  it('returns null for a box that does not exist', async () => {
    mockFetch([{ status: 404, body: { error: 'no such box' } }]);
    const sdk = orble(config);
    expect(await sdk.instances.getById('nope')).toBeNull();
  });

  it('shares a port and returns its address', async () => {
    const calls = mockFetch([{ body: box }, { body: { url: 'https://3000-k7f2.orble.dev' } }]);
    const sdk = orble(config);
    const instance = await sdk.instances.create({ size: 'm' } as any);
    expect(await instance.getUrl({ port: 3000, public: true } as any)).toBe('https://3000-k7f2.orble.dev');
    expect(calls[1]).toMatchObject({ url: 'https://orble.example/v1/boxes/k7f2/ports/3000', method: 'PUT', body: { access: 'public' } });
  });

  it('sends a background command detached and quoted', async () => {
    const calls = mockFetch([{ body: box }, { body: { exit_code: 0, stdout: '', stderr: '' } }]);
    const instance = await orble(config).instances.create({ size: 's' } as any);
    await instance.runCommand(`echo "a $HOME" > out`, { background: true } as any);
    expect((calls[1].body as any).command).toBe('nohup sh -c "echo \\"a \\$HOME\\" > out" >/dev/null 2>&1 &');
  });

  it('reads a whole file in one streamed request', async () => {
    const calls = mockFetch([{ body: box }, { raw: 'hello world' }]);
    const instance = await orble(config).instances.create({ size: 's' } as any);
    expect(await instance.filesystem.readFile('notes.txt')).toBe('hello world');
    expect(calls[1].url).toBe('https://orble.example/v1/boxes/k7f2/files?path=notes.txt&raw=1&user=root');
  });

  it('runs commands and file operations as root by default', async () => {
    const calls = mockFetch([
      { body: box },
      { body: { exit_code: 0, stdout: '0\n' } },
      { raw: 'x' },
      { body: { path: '/etc/x', bytes: 1 } },
    ]);
    const instance = await orble(config).instances.create({ size: 's' } as any);
    await instance.runCommand('id -u');
    expect(calls[1].body).toMatchObject({ command: 'id -u', user: 'root' });
    await instance.filesystem.readFile('/etc/x');
    expect(calls[2].url).toBe('https://orble.example/v1/boxes/k7f2/files?path=%2Fetc%2Fx&raw=1&user=root');
    await instance.filesystem.writeFile('/etc/x', 'x');
    expect(calls[3].url).toBe('https://orble.example/v1/boxes/k7f2/files?path=%2Fetc%2Fx&user=root');
  });

  it('runs as agent when configured, and per command either way', async () => {
    const calls = mockFetch([
      { body: box },
      { body: { exit_code: 0, stdout: '1000\n' } },
      { raw: 'x' },
      { body: { exit_code: 0, stdout: '0\n' } },
      { body: box },
      { body: { exit_code: 0, stdout: '1000\n' } },
    ]);
    const agent = await orble({ ...config, user: 'agent' }).instances.create({ size: 's' } as any);
    await agent.runCommand('id -u');
    expect(calls[1].body).not.toHaveProperty('user');
    await agent.filesystem.readFile('notes.txt');
    expect(calls[2].url).toBe('https://orble.example/v1/boxes/k7f2/files?path=notes.txt&raw=1');
    await agent.runCommand('id -u', { user: 'root' } as any);
    expect(calls[3].body).toMatchObject({ user: 'root' });
    const root = await orble(config).instances.create({ size: 's' } as any);
    await root.runCommand('id -u', { user: 'agent' } as any);
    expect(calls[5].body).not.toHaveProperty('user');
  });

  it('takes the user from ORBLE_USER', async () => {
    const calls = mockFetch([{ body: box }, { body: { exit_code: 0, stdout: '1000\n' } }]);
    vi.stubEnv('ORBLE_USER', 'agent');
    const instance = await orble(config).instances.create({ size: 's' } as any);
    await instance.runCommand('id -u');
    expect(calls[1].body).not.toHaveProperty('user');
  });

  it('treats an empty ORBLE_USER as unset', async () => {
    const calls = mockFetch([{ body: box }, { body: { exit_code: 0, stdout: '0\n' } }]);
    vi.stubEnv('ORBLE_USER', '');
    const instance = await orble(config).instances.create({ size: 's' } as any);
    await instance.runCommand('id -u');
    expect(calls[1].body).toMatchObject({ user: 'root' });
  });

  it('refuses an unknown user', () => {
    expect(() => orble({ ...config, user: 'admin' as any }).instances.create({ size: 's' } as any)).rejects.toThrow(/agent' or 'root/);
  });

  it('writes a file as the raw request body', async () => {
    const calls = mockFetch([{ body: box }, { body: { path: '/tmp/a b', bytes: 3 } }]);
    const instance = await orble(config).instances.create({ size: 's' } as any);
    await instance.filesystem.writeFile('/tmp/a b', 'abc');
    expect(calls[1]).toMatchObject({ url: 'https://orble.example/v1/boxes/k7f2/files?path=%2Ftmp%2Fa%20b&user=root', method: 'PUT' });
    expect(Buffer.from(calls[1].body as Uint8Array).toString()).toBe('abc');
  });

  it('reports running only for a running box', () => {
    expect(infoStatus('running')).toBe('running');
    expect(infoStatus('error')).toBe('error');
    for (const state of ['creating', 'suspended', 'stopped', 'deleting', 'deleted']) expect(infoStatus(state)).toBe('stopped');
  });

  it('turns an API error into a message with the status and the API\'s reason', async () => {
    mockFetch([{ status: 400, body: { error: 'the box sizes are micro, s, m and l' } }]);
    await expect(orble(config).instances.create({ size: 'xl' } as any)).rejects.toThrow(
      'Orble API error (400) on POST /v1/boxes: the box sizes are micro, s, m and l',
    );
  });

  it('suspends and resumes a box, keeping its memory', async () => {
    const calls = mockFetch([{ body: box }, { body: { ...box, state: 'suspended' } }, { body: box }]);
    const sdk = orble(config);
    expect(sdk.instances.pause).toEqual({ memory: true });
    const instance = await sdk.instances.create({ size: 'l' } as any);
    await instance.pause!();
    await instance.resume!();
    expect(calls[1]).toMatchObject({ url: 'https://orble.example/v1/boxes/k7f2/suspend', method: 'POST' });
    expect(calls[2]).toMatchObject({ url: 'https://orble.example/v1/boxes/k7f2/resume', method: 'POST' });
    expect((instance.getInstance() as any).data.state).toBe('running');
  });

  it('fails to pause a box that is gone', async () => {
    mockFetch([{ body: box }, { status: 404, body: { error: 'no such box' } }]);
    const instance = await orble(config).instances.create({ size: 'l' } as any);
    await expect(instance.pause!()).rejects.toThrow('Orble box k7f2 not found');
  });

  const snap = { name: 'k7f2-1', box: 'k7f2', state: 'ready', vcpus: 8, mem_mib: 16384, disk_bytes: 1024, created_at: '2026-11-23T12:00:00Z' };
  const gallerySnap = { name: 'python', state: 'ready', vcpus: 1, mem_mib: 2048, created_at: '2026-11-01T00:00:00Z', gallery: true, about: 'Python 3' };

  it('declares what snapshots keep', () => {
    expect(orble(config).snapshot!.capabilities).toEqual({ scope: 'rootfs', memory: true, destroysSource: false, source: 'kept', fork: true });
  });

  it('snapshots a box, with or without a name', async () => {
    const calls = mockFetch([{ body: snap }, { body: { ...snap, name: 'base' } }]);
    const sdk = orble(config);
    const made = await sdk.snapshot!.create('k7f2');
    expect(made).toEqual({
      id: 'k7f2-1', provider: 'orble', createdAt: new Date('2026-11-23T12:00:00Z'),
      metadata: { state: 'ready', box: 'k7f2', vcpus: 8, memMiB: 16384, diskBytes: 1024 },
    });
    expect(calls[0]).toMatchObject({ url: 'https://orble.example/v1/boxes/k7f2/snapshot', method: 'POST', body: {} });
    expect((await sdk.snapshot!.create('k7f2', { name: 'base' })).id).toBe('base');
    expect(calls[1].body).toEqual({ name: 'base' });
  });

  it('fails to snapshot a box that is gone or stopped', async () => {
    mockFetch([{ status: 404, body: { error: 'no such box' } }, { status: 409, body: { error: 'box k7f2 is stopped' } }]);
    const sdk = orble(config);
    await expect(sdk.snapshot!.create('k7f2')).rejects.toThrow('Orble box k7f2 not found');
    await expect(sdk.snapshot!.create('k7f2')).rejects.toThrow('Orble API error (409) on POST /v1/boxes/k7f2/snapshot: box k7f2 is stopped');
  });

  it('lists the account\'s snapshots, by box and up to a limit', async () => {
    const other = { ...snap, name: 'q9x1-1', box: 'q9x1' };
    const calls = mockFetch([{ body: [snap, other, gallerySnap] }, { body: [snap, other, gallerySnap] }, { body: [snap, other, gallerySnap] }]);
    const sdk = orble(config);
    expect((await sdk.snapshot!.list()).map((s: any) => s.id)).toEqual(['k7f2-1', 'q9x1-1']);
    expect((await sdk.snapshot!.list({ instanceId: 'q9x1' })).map((s: any) => s.id)).toEqual(['q9x1-1']);
    expect((await sdk.snapshot!.list({ limit: 1 })).map((s: any) => s.id)).toEqual(['k7f2-1']);
    expect(calls[0]).toMatchObject({ url: 'https://orble.example/v1/snapshots', method: 'GET' });
  });

  it('deletes a snapshot, and treats one already gone as deleted', async () => {
    const calls = mockFetch([{ body: { ok: true } }, { status: 404, body: { error: 'no such snapshot' } }]);
    const sdk = orble(config);
    await sdk.snapshot!.delete('k7f2-1');
    await sdk.snapshot!.delete('k7f2-1');
    expect(calls[0]).toMatchObject({ url: 'https://orble.example/v1/snapshots/k7f2-1', method: 'DELETE' });
  });

  it('refuses to delete a snapshot still being taken', async () => {
    mockFetch([{ status: 409, body: { error: "snapshot k7f2-1 isn't ready yet" } }]);
    await expect(orble(config).snapshot!.delete('k7f2-1')).rejects.toThrow("Orble API error (409) on DELETE /v1/snapshots/k7f2-1: snapshot k7f2-1 isn't ready yet");
  });

  it('lists every snapshot a box can start from as a template, and builds none', async () => {
    const calls = mockFetch([{ body: [snap, gallerySnap] }, { body: { ok: true } }]);
    const sdk = orble(config);
    const templates = await sdk.template!.list();
    expect(templates.map((t: any) => t.id)).toEqual(['k7f2-1', 'python']);
    expect((templates[1] as any).metadata).toMatchObject({ gallery: true, about: 'Python 3' });
    await sdk.template!.delete('k7f2-1');
    expect(calls[1]).toMatchObject({ url: 'https://orble.example/v1/snapshots/k7f2-1', method: 'DELETE' });
    await expect(sdk.template!.create({ name: 'x' })).rejects.toThrow(/snapshot\.create\(\)/);
  });

  it('says where to get a key when none is set', async () => {
    const saved = process.env.ORBLE_API_KEY;
    delete process.env.ORBLE_API_KEY;
    try {
      await expect(orble({}).instances.create({} as any)).rejects.toThrow(/ORBLE_API_KEY/);
    } finally {
      if (saved !== undefined) process.env.ORBLE_API_KEY = saved;
    }
  });
});
