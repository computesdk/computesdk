import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BoatApi, Configuration, runCommand } from '@boatdev/sdk';
import { boat, getBoatUrl, readBoatFile, writeBoatFile } from '../index';

const api = vi.hoisted(() => ({
  create: vi.fn(), get: vi.fn(), sandboxes: vi.fn(), deleteSandbox: vi.fn(),
  update: vi.fn(), command: vi.fn(), hostPort: vi.fn(), stopCommand: vi.fn(),
  createUploadUrl: vi.fn(), createDownloadUrl: vi.fn(), saveNamedSnapshot: vi.fn(),
  getNamedSnapshot: vi.fn(), listNamedSnapshots: vi.fn(), deleteNamedSnapshot: vi.fn(),
}));

vi.mock('@boatdev/sdk', () => ({
  BoatApi: vi.fn(() => api), Configuration: vi.fn(config => config),
  runCommand: vi.fn(),
}));

const info = { id: 'bx_test', name: 'test', state: 'ready', createdAt: new Date('2026-01-01'), ttlSeconds: 3600 };
const provider = () => boat({ apiKey: 'test-key' });
const missing = { response: { status: 404 } };

function frames(stdout = 'hello', stderr = '', exitCode: number | null = 0, timedOut = false) {
  return (async function* () {
    yield { type: 'started' as const, processId: 123 };
    yield { type: 'stdout' as const, data: stdout };
    yield { type: 'stderr' as const, data: stderr };
    yield { type: 'exit' as const, exitCode, timedOut };
  })();
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv('BOAT_API_KEY', '');
  vi.stubEnv('BOAT_API_BASE', '');
  vi.mocked(BoatApi).mockImplementation(() => api as unknown as BoatApi);
  vi.mocked(Configuration).mockImplementation(config => config as Configuration);
  api.create.mockResolvedValue({ sandbox: info });
  api.get.mockResolvedValue({ sandbox: info });
  vi.mocked(runCommand).mockImplementation(() => frames());
  api.command.mockResolvedValue({ processId: 123 });
  api.createUploadUrl.mockResolvedValue({ url: 'https://files.example/upload?signature=secret', method: 'PUT' });
  api.createDownloadUrl.mockResolvedValue({ url: 'https://files.example/download?signature=secret', method: 'GET' });
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('hello')));
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('Boat lifecycle', () => {
  it('requires credentials and resolves environment fallbacks and explicit overrides', async () => {
    await expect(boat({}).instances.create()).rejects.toThrow('BOAT_API_KEY');
    expect(api.create).not.toHaveBeenCalled();
    vi.stubEnv('BOAT_API_KEY', 'env-key');
    vi.stubEnv('BOAT_API_BASE', 'https://boat.example/api/v1');
    await boat({}).instances.create();
    expect(Configuration).toHaveBeenLastCalledWith(expect.objectContaining({ accessToken: 'env-key', basePath: 'https://boat.example/api/v1' }));
    await boat({ apiKey: 'explicit', baseURL: 'https://other.example/api/v1' }).instances.create();
    expect(Configuration).toHaveBeenLastCalledWith(expect.objectContaining({ accessToken: 'explicit', basePath: 'https://other.example/api/v1' }));
  });

  it('maps lifetime, environment and snapshot options, waits for readiness, then names the sandbox', async () => {
    const sdk = boat({ apiKey: 'key', timeout: 50_000, readyTimeout: 1000, createOptions: { type: 'small', noEnv: true } });
    const instance = await sdk.instances.create({ timeout: 1001, envs: { HELLO: 'world' }, snapshotId: 'saved', name: 'demo', type: 'large' });
    expect(api.create).toHaveBeenCalledWith({ createSandboxRequest: expect.objectContaining({
      ttlSeconds: 2, env: { HELLO: 'world' }, from: 'saved', type: 'large', noEnv: true,
    }) });
    expect(api.get).toHaveBeenCalledWith({ sandboxId: info.id });
    expect(api.update).toHaveBeenCalledWith({ sandboxId: info.id, updateSandboxRequest: { name: 'demo' } });
    expect(instance.getInstance()).toEqual({ api, id: info.id, name: 'demo' });
    expect(sdk.sandbox).toBe(sdk.instances);
    await sdk.instances.create();
    expect(api.create.mock.lastCall?.[0].createSandboxRequest.ttlSeconds).toBe(50);
  });

  it('preserves native disabled auto-stop and rejects conflicting snapshots and invalid timeouts', async () => {
    await boat({ apiKey: 'key', createOptions: { ttlSeconds: null } }).instances.create();
    expect(api.create.mock.lastCall?.[0].createSandboxRequest.ttlSeconds).toBeNull();
    await expect(provider().instances.create({ snapshotId: 'a', templateId: 'b' })).rejects.toThrow('either');
    await expect(provider().instances.create({ timeout: -1 })).rejects.toThrow('positive');
  });

  it('allows native per-call env, TTL, and legacy organization aliases', async () => {
    await boat({ apiKey: 'key', timeout: 1000 }).instances.create({ ttlSeconds: null, env: { HELLO: 'native' }, teamId: 'team' });
    expect(api.create).toHaveBeenLastCalledWith({ createSandboxRequest: expect.objectContaining({ ttlSeconds: null, env: { HELLO: 'native' }, org: 'team' }) });
  });

  it('deletes a newly created sandbox when provisioning fails and preserves cleanup failures', async () => {
    api.get.mockResolvedValue({ sandbox: { ...info, state: 'error' } });
    await expect(provider().instances.create()).rejects.toThrow('terminal state error');
    expect(api.deleteSandbox).toHaveBeenCalledWith({ sandboxId: info.id, xAsciiConfirmDelete: info.id });
    api.deleteSandbox.mockRejectedValue(new Error('cleanup denied'));
    await expect(provider().instances.create()).rejects.toThrow('cleanup denied');
  });

  it('stops waiting on a cancelled sandbox and reports it even when Boat already removed it', async () => {
    api.get.mockResolvedValue({ sandbox: { ...info, state: 'cancelled' } });
    api.deleteSandbox.mockRejectedValue(missing);
    await expect(provider().instances.create()).rejects.toThrow('terminal state cancelled');
    expect(api.get).toHaveBeenCalledTimes(1);
  });

  it('polls until ready and defaults the provisioning deadline to five minutes', async () => {
    vi.useFakeTimers();
    api.get.mockResolvedValueOnce({ sandbox: { ...info, state: 'provisioning' } });
    const creating = provider().instances.create();
    await vi.advanceTimersByTimeAsync(2000);
    await creating;
    expect(api.get).toHaveBeenCalledTimes(2);
    api.get.mockResolvedValue({ sandbox: { ...info, state: 'provisioning' } });
    const stuck = provider().instances.create();
    const assertion = expect(stuck).rejects.toThrow('Timed out');
    await vi.advanceTimersByTimeAsync(299_999);
    expect(api.deleteSandbox).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2);
    await assertion;
  });

  it('stops waiting when creation is aborted during provisioning', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    api.get.mockResolvedValue({ sandbox: { ...info, state: 'provisioning' } });
    const creating = provider().instances.create({ signal: controller.signal });
    const assertion = expect(creating).rejects.toThrow();
    controller.abort(new Error('stop'));
    await vi.advanceTimersByTimeAsync(2000);
    await assertion;
    expect(api.deleteSandbox).toHaveBeenCalledWith({ sandboxId: info.id, xAsciiConfirmDelete: info.id });
  });

  it('does not create when already aborted', async () => {
    const controller = new AbortController(); controller.abort(new Error('cancelled'));
    await expect(provider().instances.create({ signal: controller.signal })).rejects.toThrow(/aborted/i);
    expect(api.create).not.toHaveBeenCalled();
  });

  it('returns null only for missing sandboxes and propagates authorization failures', async () => {
    expect((await provider().instances.getById(info.id))?.getInstance()).toMatchObject({ id: info.id, name: info.name });
    api.get.mockRejectedValue(missing);
    expect(await provider().instances.getById('absent')).toBeNull();
    api.get.mockRejectedValue(new Error('unauthorized'));
    await expect(provider().instances.getById(info.id)).rejects.toThrow('unauthorized');
  });

  it('collects all pages of active sandboxes without resuming stopped ones', async () => {
    api.sandboxes.mockResolvedValueOnce({ sandboxes: [info, { ...info, id: 'stopped', state: 'archived' }], pageInfo: { hasMore: true, nextCursor: 'next' } })
      .mockResolvedValueOnce({ sandboxes: [{ ...info, id: 'second', name: 'other', state: 'idle' }], pageInfo: { hasMore: false, nextCursor: null } });
    const instances = await provider().instances.list();
    expect(instances.map(instance => instance.getInstance().id)).toEqual([info.id, 'second']);
    expect(instances.map(instance => instance.getInstance().name)).toEqual([info.name, 'other']);
    expect(api.sandboxes).toHaveBeenLastCalledWith({ cursor: 'next' });
    expect(api.get).not.toHaveBeenCalled();
  });

  it('destroy deletes permanently, ignores 404, and propagates other errors', async () => {
    await provider().instances.destroy(info.id);
    expect(api.deleteSandbox).toHaveBeenCalledWith({ sandboxId: info.id, xAsciiConfirmDelete: info.id });
    api.deleteSandbox.mockRejectedValue(missing);
    await expect(provider().instances.destroy(info.id)).resolves.toBeUndefined();
    api.deleteSandbox.mockRejectedValue(new Error('denied'));
    await expect(provider().instances.destroy(info.id)).rejects.toThrow('denied');
  });

  it.each([['ready', 'running'], ['archived', 'stopped'], ['error', 'error'], ['cancelled', 'error']])('maps %s metadata to %s', async (state, status) => {
    const instance = await provider().instances.create();
    api.get.mockResolvedValue({ sandbox: { ...info, state } });
    expect(await instance.getInfo()).toMatchObject({ id: info.id, provider: 'boat', status, createdAt: info.createdAt, timeout: 3600000 });
  });

  it('returns the protected preview URL intact', async () => {
    const instance = await provider().instances.create();
    api.hostPort.mockResolvedValue({ url: 'https://bx_test-3000.on.boat.dev?_token=secret' });
    expect(await instance.getUrl({ port: 3000 })).toBe('https://bx_test-3000.on.boat.dev?_token=secret');
    expect(api.hostPort).toHaveBeenCalledWith({ sandboxId: info.id, hostPortRequest: { port: 3000 } });
    await expect(instance.getUrl({ port: 3000, protocol: 'http' })).rejects.toThrow('HTTPS');
  });
});

describe('Boat commands and filesystem', () => {
  it('preserves output and nonzero exits and applies environment values to the full expression', async () => {
    const instance = await provider().instances.create();
    vi.mocked(runCommand).mockImplementation(() => frames('partial', 'failed', 7));
    expect(await instance.runCommand('echo "$VALUE" | cat', { cwd: '/tmp', timeout: 1001, env: { VALUE: "$(touch /tmp/bad)' hi" } })).toMatchObject({ stdout: 'partial', stderr: 'failed', exitCode: 7 });
    expect(runCommand).toHaveBeenCalledWith(api, info.id, expect.stringContaining('cd -- "/tmp" || exit\nenv "VALUE=\\$(touch /tmp/bad)\' hi" /bin/sh -c '), { signal: expect.any(AbortSignal) });
    await expect(instance.runCommand('true', { env: { 'bad=name': 'value' } })).rejects.toThrow('Invalid environment');
  });

  it('accepts timeouts beyond 600 seconds and maps signal termination to failure', async () => {
    const instance = await provider().instances.create();
    vi.mocked(runCommand).mockImplementation(() => frames('', '', null));
    expect((await instance.runCommand('long command', { timeout: 900000 })).exitCode).toBe(1);
    await expect(instance.runCommand('invalid', { timeout: -1 })).rejects.toThrow('non-negative');
  });

  it('stops a timed-out detached command and preserves partial output', async () => {
    vi.useFakeTimers();
    const instance = await provider().instances.create();
    vi.mocked(runCommand).mockImplementation(async function* (_api, _id, _command, options) {
      yield { type: 'started', processId: 123 };
      yield { type: 'stdout', data: 'partial' };
      await new Promise((_resolve, reject) => options?.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true }));
    });
    const running = instance.runCommand('sleep 10', { timeout: 1000 });
    await vi.advanceTimersByTimeAsync(1000);
    expect(await running).toMatchObject({ stdout: 'partial', exitCode: 124 });
    expect(api.stopCommand).toHaveBeenCalledWith({ sandboxId: info.id, processId: 123 });
  });

  it('reports failed cleanup after a stream failure with the original error', async () => {
    const instance = await provider().instances.create();
    vi.mocked(runCommand).mockImplementation(async function* () { yield { type: 'started', processId: 123 }; throw new Error('network'); });
    api.stopCommand.mockRejectedValue(new Error('denied'));
    await expect(instance.runCommand('test')).rejects.toThrow(/Failed to stop Boat process 123 after stream failure \(network\): Error: denied/);
    api.stopCommand.mockRejectedValue(missing);
    await expect(instance.runCommand('test')).rejects.toThrow(/^network$/);
  });

  it('reports failed cleanup after a timeout', async () => {
    vi.useFakeTimers();
    const instance = await provider().instances.create();
    vi.mocked(runCommand).mockImplementation(async function* (_api, _id, _command, options) {
      yield { type: 'started', processId: 123 };
      await new Promise((_resolve, reject) => options?.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true }));
    });
    api.stopCommand.mockRejectedValue(new Error('denied'));
    const running = instance.runCommand('sleep 10', { timeout: 1000 });
    const assertion = expect(running).rejects.toThrow('after timeout');
    await vi.advanceTimersByTimeAsync(1000);
    await assertion;
  });

  it('keeps a stream failure when cleanup finishes after the deadline', async () => {
    vi.useFakeTimers();
    const instance = await provider().instances.create();
    api.stopCommand.mockImplementation(() => new Promise(resolve => setTimeout(resolve, 2000)));
    const running = instance.runCommand('test', { timeout: 1000, onStdout: () => { throw new Error('callback'); } });
    const assertion = expect(running).rejects.toThrow('callback');
    await vi.advanceTimersByTimeAsync(2000);
    await assertion;
    expect(api.stopCommand).toHaveBeenCalledWith({ sandboxId: info.id, processId: 123 });
  });

  it('maps a server-side timeout exit to 124', async () => {
    const instance = await provider().instances.create();
    vi.mocked(runCommand).mockImplementation(() => frames('', '', null, true));
    expect((await instance.runCommand('sleep 10')).exitCode).toBe(124);
  });

  it('starts background commands without attaching', async () => {
    const instance = await provider().instances.create();
    expect(await instance.runCommand('sleep 1000', { background: true, cwd: '/tmp' })).toMatchObject({ exitCode: 0 });
    expect(api.command).toHaveBeenCalledWith({ sandboxId: info.id, commandRequest: { command: 'cd -- "/tmp" || exit\nsleep 1000', detached: true } });
    expect(runCommand).not.toHaveBeenCalled();
  });

  it('streams both callbacks and preserves failure exits', async () => {
    const instance = await provider().instances.create();
    vi.mocked(runCommand).mockImplementation(() => frames('first', 'warning', 2));
    const onStdout = vi.fn(); const onStderr = vi.fn();
    expect(await instance.runCommand('test', { onStdout, onStderr })).toMatchObject({ stdout: 'first', stderr: 'warning', exitCode: 2 });
    expect(onStdout).toHaveBeenCalledWith('first'); expect(onStderr).toHaveBeenCalledWith('warning');
  });

  it('stops commands on stream errors, missing exits, and callback failures', async () => {
    const instance = await provider().instances.create();
    vi.mocked(runCommand).mockImplementation(async function* () { yield { type: 'started', processId: 123 }; yield { type: 'error', message: 'failed' }; });
    await expect(instance.runCommand('test')).rejects.toThrow('failed');
    expect(api.stopCommand).toHaveBeenCalledWith({ sandboxId: info.id, processId: 123 });
    vi.mocked(runCommand).mockImplementation(async function* () { yield { type: 'started', processId: 123 }; });
    await expect(instance.runCommand('test')).rejects.toThrow('without an exit');
    vi.mocked(runCommand).mockImplementation(() => frames());
    await expect(instance.runCommand('test', { onStdout: () => { throw new Error('callback'); } })).rejects.toThrow('callback');
  });

  it('transfers text and binary using signed URLs without leaking bearer credentials', async () => {
    const instance = await provider().instances.create();
    expect(await instance.filesystem.readFile("/tmp/a' $x")).toBe('hello');
    expect(api.createDownloadUrl).toHaveBeenCalledWith({ sandboxId: info.id, fileUrlRequest: { path: "/tmp/a' $x" } });
    expect(fetch).toHaveBeenCalledWith('https://files.example/download?signature=secret');
    vi.mocked(fetch).mockResolvedValueOnce(new Response());
    const bytes = new Uint8Array([0, 255, 128]);
    await writeBoatFile(instance.getInstance(), '/tmp/file', bytes);
    expect(fetch).toHaveBeenLastCalledWith('https://files.example/upload?signature=secret', { method: 'PUT', body: Buffer.from(bytes) });
    vi.mocked(fetch).mockResolvedValueOnce(new Response(bytes));
    expect(await readBoatFile(instance.getInstance(), '/tmp/file')).toEqual(bytes);
    vi.mocked(fetch).mockResolvedValueOnce(new Response('denied', { status: 403 }));
    await expect(instance.filesystem.readFile('/tmp/denied')).rejects.toThrow('HTTP 403');
  });

  it.each([
    ['relative/file', true], ['/home/user/file', true], ['/tmp/nested/file', true],
    ['/home/user', false], ['/tmp', false], ['/tmp/../etc/passwd', false], ['/var/file', false],
  ])('routes %s through signed transfer: %s', async (path, signed) => {
    const instance = await provider().instances.create();
    vi.mocked(runCommand).mockImplementation(() => frames(Buffer.from('hello').toString('base64')));
    expect(await instance.filesystem.readFile(path)).toBe('hello');
    expect(api.createDownloadUrl).toHaveBeenCalledTimes(signed ? 1 : 0);
    expect(runCommand).toHaveBeenCalledTimes(signed ? 0 : 1);
  });

  it('writes outside signed roots in bounded base64 chunks', async () => {
    const instance = await provider().instances.create();
    const content = 'x'.repeat(48 * 1024);
    await instance.filesystem.writeFile('/var/file', content);
    const commands = vi.mocked(runCommand).mock.calls.map(call => call[2]);
    expect(commands[0]).toBe(': > "/var/file"');
    expect(commands.slice(1).join('')).toContain(Buffer.from(content).toString('base64').slice(0, 48 * 1024));
    expect(commands).toHaveLength(3);
    expect(api.createUploadUrl).not.toHaveBeenCalled();
  });

  it('uses shell operations for directories and paths outside signed transfer roots', async () => {
    const instance = await provider().instances.create();
    await instance.filesystem.mkdir('/tmp/dir');
    await instance.filesystem.remove('/tmp/dir');
    vi.mocked(runCommand).mockImplementation(() => frames(JSON.stringify([{ name: '世界\nfile', type: 'file', size: 3, modified: 10 }])));
    expect(await instance.filesystem.readdir('/tmp')).toEqual([{ name: '世界\nfile', type: 'file', size: 3, modified: new Date(10000) }]);
    vi.mocked(runCommand).mockImplementation(() => frames('', '', 1));
    expect(await instance.filesystem.exists('/missing')).toBe(false);
    vi.mocked(runCommand).mockImplementation(() => frames('', 'permission denied', 1));
    await expect(instance.filesystem.writeFile('/etc/denied', 'text')).rejects.toThrow('permission denied');
    await expect(instance.filesystem.readFile('/etc/denied')).rejects.toThrow('permission denied');
  });

  it('applies preview defaults and typed per-call overrides', async () => {
    const instance = await boat({ apiKey: 'key', preview: { localhost: true, public: false } }).instances.create();
    api.hostPort.mockResolvedValue({ url: 'https://preview.example' });
    await instance.getUrl({ port: 8000 });
    expect(api.hostPort).toHaveBeenLastCalledWith({ sandboxId: info.id, hostPortRequest: { port: 8000, localhost: true, _public: false } });
    await getBoatUrl(instance.getInstance(), { port: 8000, public: true, title: 'app' });
    expect(api.hostPort).toHaveBeenLastCalledWith({ sandboxId: info.id, hostPortRequest: { port: 8000, localhost: true, _public: true, title: 'app' } });
  });
});

const snapshot = { name: 'saved', status: 'ready', sourceSandboxId: info.id, snapshotId: 'non-bootable-artifact-id', createdAt: new Date('2026-01-01') };

describe('Boat named snapshots and templates', () => {
  it('waits for readiness and returns the name as the reusable ID', async () => {
    vi.useFakeTimers();
    api.saveNamedSnapshot.mockResolvedValue({ snapshot: { ...snapshot, status: 'saving' } });
    api.getNamedSnapshot.mockResolvedValue({ snapshot });
    const saving = provider().snapshot.create(info.id, { name: 'saved' });
    await vi.advanceTimersByTimeAsync(2000);
    expect(await saving).toMatchObject({ id: 'saved', snapshotId: 'non-bootable-artifact-id', provider: 'boat' });
  });

  it('generates valid unique names and creates typed templates from a source sandbox', async () => {
    api.saveNamedSnapshot.mockImplementation(async ({ namedSnapshotSaveRequest }) => ({ snapshot: { ...snapshot, name: namedSnapshotSaveRequest.name } }));
    expect((await provider().snapshot.create(info.id)).id).toMatch(/^compute-/);
    expect(await provider().template.create({ name: 'saved', sandboxId: info.id })).toMatchObject({ id: 'saved', templateId: 'saved' });
    expect(api.saveNamedSnapshot).toHaveBeenLastCalledWith({ namedSnapshotSaveRequest: { sandboxId: info.id, name: 'saved' } });
  });

  it('lists, filters, limits, and deletes the same named artifacts through both managers', async () => {
    api.listNamedSnapshots.mockResolvedValue({ snapshots: [snapshot, { ...snapshot, name: 'other', sourceSandboxId: 'other' }] });
    expect(await provider().snapshot.list({ instanceId: info.id, limit: 1 })).toEqual([expect.objectContaining({ id: 'saved' })]);
    expect((await provider().template.list({ limit: 1 }))[0].templateId).toBe('saved');
    await provider().snapshot.delete('saved');
    await provider().template.delete('other');
    expect(api.deleteNamedSnapshot).toHaveBeenCalledWith({ name: 'saved' });
    expect(api.deleteNamedSnapshot).toHaveBeenCalledWith({ name: 'other' });
    api.deleteNamedSnapshot.mockRejectedValue(missing);
    await expect(provider().snapshot.delete('absent')).resolves.toBeUndefined();
    await expect(provider().snapshot.list({ limit: -1 })).rejects.toThrow('non-negative');
  });

  it('rejects invalid names, metadata, unsupported template fields, and failed saves', async () => {
    await expect(provider().snapshot.create(info.id, { name: 'Bad Name' })).rejects.toThrow('snapshot names');
    await expect(provider().snapshot.create(info.id, { name: 'latest' })).rejects.toThrow('reserved');
    await expect(provider().snapshot.create(info.id, { metadata: {} })).rejects.toThrow('metadata');
    await expect(provider().template.create({ name: 'saved', sandboxId: info.id, description: 'text' })).rejects.toThrow('descriptions');
    api.saveNamedSnapshot.mockResolvedValue({ snapshot: { ...snapshot, status: 'failed', error: 'disk' } });
    await expect(provider().snapshot.create(info.id)).rejects.toThrow('disk');
    await expect(provider().instances.create({ metadata: {} })).rejects.toThrow('metadata');
    await expect(provider().instances.create({ memoryMiB: 1024 })).rejects.toThrow('machine type');
  });

  it('bounds saving waits without silently deleting a possibly existing name', async () => {
    vi.useFakeTimers();
    api.saveNamedSnapshot.mockResolvedValue({ snapshot: { ...snapshot, status: 'saving' } });
    api.getNamedSnapshot.mockResolvedValue({ snapshot: { ...snapshot, status: 'saving' } });
    const saving = boat({ apiKey: 'key', snapshotTimeout: 5 }).snapshot.create(info.id, { name: 'saved' });
    const assertion = expect(saving).rejects.toThrow('Timed out');
    await vi.advanceTimersByTimeAsync(5);
    await assertion;
    expect(api.deleteNamedSnapshot).not.toHaveBeenCalled();
  });

  it('reports a save that fails while polling', async () => {
    vi.useFakeTimers();
    api.saveNamedSnapshot.mockResolvedValue({ snapshot: { ...snapshot, status: 'saving' } });
    api.getNamedSnapshot.mockResolvedValue({ snapshot: { ...snapshot, status: 'failed', error: 'quota' } });
    const saving = provider().snapshot.create(info.id, { name: 'saved' });
    const assertion = expect(saving).rejects.toThrow('quota');
    await vi.advanceTimersByTimeAsync(2000);
    await assertion;
  });
});
