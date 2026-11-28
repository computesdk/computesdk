import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { offstage, OffstageError } from '../index';
import { failure, json, killSession, startApi, type FakeApi, type Reply, type Seen } from './fake-api';

// lazyCreate against a local stand-in for the API (fake-api.ts).
const SBX = 'sbx_test1';
const RECORD = {
  id: SBX, name: 'swift-otter', session: 'headless', state: 'pending',
  createdAt: 1793000000000, expiresAt: 1793000900000, timeoutMs: 900000, idleTimeoutMs: 600000,
};
const FINISHED = { commandId: 'cmd_1', state: 'finished', exitCode: 0, timedOut: false, stdout: 'v24.1.0\n', stderr: '', durationMs: 12 };
const PLACEHOLDER = /^lazy_[0-9a-f-]{36}$/;

describe('lazyCreate', () => {
  let api: FakeApi;
  const provider = (config: { lazyCreate?: boolean } = { lazyCreate: true }) => offstage({ apiKey: 'sk_offstage_test', baseUrl: api.url, ...config });
  const routes = (seen: Seen[] = api.requests) => seen.map(({ method, path }) => [method, path]);
  const bodyOf = (seen: Seen) => JSON.parse(seen.body);
  const created = (run?: unknown): Reply => json(201, run === undefined ? RECORD : { ...RECORD, run });

  beforeEach(async () => {
    api = await startApi();
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await api.close();
  });

  it('create() sends nothing; the first runCommand creates the sandbox and runs the command in one request', async () => {
    const sandbox = await provider().sandbox.create({ timeout: 60_000, name: 'ios-build' });
    expect(sandbox.sandboxId).toMatch(PLACEHOLDER);
    expect(api.requests).toHaveLength(0);

    api.reply(created(FINISHED));
    const result = await sandbox.runCommand('node -v', { env: { CI: '1' }, timeout: 5_000 });
    expect(result).toMatchObject({ stdout: 'v24.1.0\n', stderr: '', exitCode: 0 });
    expect(routes()).toEqual([['POST', '/v1/sandboxes']]);
    expect(api.requests[0].headers['idempotency-key']).toMatch(/^[0-9a-f-]{36}$/);
    expect(bodyOf(api.requests[0])).toEqual({
      session: 'headless', timeoutMs: 60_000, name: 'ios-build',
      run: { cmd: 'node -v', envs: { CI: '1' }, timeoutMs: 5_000 },
    });

    // Later commands go to the sandbox the create made.
    api.reply(json(200, FINISHED));
    await sandbox.runCommand('node -v');
    expect(routes().slice(1)).toEqual([['POST', `/v1/sandboxes/${SBX}/commands`]]);
  });

  it('follows a first command that is still running when the create answers', async () => {
    const sandbox = await provider().sandbox.create();
    api.reply(
      created({ commandId: 'cmd_1', state: 'running', startedAt: 1793000000000 }),
      json(200, { ...FINISHED, stdout: 'built\n' }),
    );
    expect((await sandbox.runCommand('swift build')).stdout).toBe('built\n');
    expect(routes()).toEqual([['POST', '/v1/sandboxes'], ['GET', `/v1/sandboxes/${SBX}/commands/cmd_1?wait=50`]]);
  });

  it('sends the first command the ordinary way when the sandbox was not ready for it', async () => {
    const sandbox = await provider().sandbox.create();
    api.reply(
      created({ error: { code: 'sandbox-not-ready', message: 'still waiting for a free headless slot', requestId: 'req_1' } }),
      json(200, FINISHED),
    );
    expect((await sandbox.runCommand('node -v', { cwd: 'app' })).exitCode).toBe(0);
    expect(routes()).toEqual([['POST', '/v1/sandboxes'], ['POST', `/v1/sandboxes/${SBX}/commands`]]);
    expect(bodyOf(api.requests[1])).toEqual({ cmd: 'node -v', cwd: 'app' });
  });

  it('surfaces a first command that could not run on that call; the sandbox it made is destroyed by its real id', async () => {
    const sandbox = await provider().sandbox.create();
    api.reply(created({ error: { code: 'sandbox-closed', message: `sandbox ${SBX} is closed (no-capacity)`, fix: 'create a new sandbox', requestId: 'req_2' } }));
    const error = await sandbox.runCommand('node -v').catch((e) => e);
    expect(error).toBeInstanceOf(OffstageError);
    expect(error).toMatchObject({ status: undefined, code: 'sandbox-closed', fix: 'create a new sandbox', requestId: 'req_2' });
    expect(error.message).toBe(`Offstage sandbox-closed: sandbox ${SBX} is closed (no-capacity) Fix: create a new sandbox. (request req_2)`);

    api.reply(json(200, { ...RECORD, state: 'closed' }));
    await sandbox.destroy();
    expect(routes()).toEqual([['POST', '/v1/sandboxes'], ['DELETE', `/v1/sandboxes/${SBX}`]]);
  });

  it('surfaces a refused create on the first call and leaves the handle unused, since the API made nothing', async () => {
    const sandbox = await provider().sandbox.create();
    api.reply(failure(402, 'payment-method-required', 'not enough credit'));
    await expect(sandbox.runCommand('node -v')).rejects.toThrow(/Offstage 402 payment-method-required/);

    // Nothing exists, so there is nothing to destroy; the next call creates afresh.
    api.reply(created(FINISHED));
    expect((await sandbox.runCommand('node -v')).exitCode).toBe(0);
    expect(routes()).toEqual([['POST', '/v1/sandboxes'], ['POST', '/v1/sandboxes']]);
    expect(api.requests[1].headers['idempotency-key']).not.toBe(api.requests[0].headers['idempotency-key']);
  });

  it('never sends again a create whose answer was lost, and every later call gets its error', async () => {
    const sandbox = await provider().sandbox.create();
    api.reply(killSession);
    await expect(sandbox.runCommand('node -v')).rejects.toThrow(/POST \/v1\/sandboxes got no answer[\s\S]*not sent again/);
    await expect(sandbox.getInfo()).rejects.toThrow(/POST \/v1\/sandboxes got no answer/);
    await expect(sandbox.runCommand('node -v')).rejects.toThrow(/POST \/v1\/sandboxes got no answer/);
    // There is no id to destroy it by.
    await sandbox.destroy();
    expect(routes()).toEqual([['POST', '/v1/sandboxes']]);
  });

  it('sends a plain create again when its connection died before the answer: its Idempotency-Key makes that safe', async () => {
    const sandbox = await provider().sandbox.create();
    api.reply(killSession, created(), json(200, { ...RECORD, state: 'ready' }));
    expect((await sandbox.getInfo()).id).toBe(SBX);
    expect(routes()).toEqual([['POST', '/v1/sandboxes'], ['POST', '/v1/sandboxes'], ['GET', `/v1/sandboxes/${SBX}`]]);
    expect(api.requests[1].headers['idempotency-key']).toBe(api.requests[0].headers['idempotency-key']);
  });

  it('destroy of a handle that was never used sends nothing, and the handle is never created after it', async () => {
    const sandbox = await provider().sandbox.create();
    await sandbox.destroy();
    await expect(sandbox.runCommand('node -v')).rejects.toThrow(/sandbox lazy_[0-9a-f-]+ was destroyed before it was created/);
    await expect(sandbox.getInfo()).rejects.toThrow(/destroyed before it was created/);
    expect(api.requests).toHaveLength(0);
  });

  it('destroy after the first call deletes the real sandbox, through the handle or the placeholder id', async () => {
    const compute = provider();
    const first = await compute.sandbox.create();
    const second = await compute.sandbox.create();
    api.otherwise((seen) => {
      if (seen.method === 'DELETE') return json(200, { ...RECORD, state: 'closed' });
      const id = api.requests.filter(({ method }) => method === 'POST').length === 1 ? 'sbx_a' : 'sbx_b';
      return json(201, { ...RECORD, id, run: FINISHED });
    });
    await first.runCommand('true');
    await second.runCommand('true');
    await first.destroy();
    await compute.sandbox.destroy(second.sandboxId);
    expect(routes().slice(2)).toEqual([['DELETE', '/v1/sandboxes/sbx_a'], ['DELETE', '/v1/sandboxes/sbx_b']]);
  });

  it('destroy through the real id leaves the placeholder naming nothing', async () => {
    const compute = provider();
    const sandbox = await compute.sandbox.create();
    const placeholder = sandbox.sandboxId;
    api.reply(created(FINISHED), json(200, { ...RECORD, state: 'closed' }), failure(404, 'not-found', 'no such sandbox'));
    await sandbox.runCommand('true');
    await compute.sandbox.destroy(SBX);
    // Looked up as an ordinary id, which names no sandbox.
    expect(await compute.sandbox.getById(placeholder)).toBeNull();
    expect(routes()).toEqual([['POST', '/v1/sandboxes'], ['DELETE', `/v1/sandboxes/${SBX}`], ['GET', `/v1/sandboxes/${placeholder}`]]);
  });

  it('destroy waits for a create in flight and deletes what it made', async () => {
    const sandbox = await provider().sandbox.create();
    api.reply({ status: 201, json: { ...RECORD, run: FINISHED }, delayMs: 50 }, json(200, { ...RECORD, state: 'closed' }));
    const [result] = await Promise.all([sandbox.runCommand('node -v'), sandbox.destroy()]);
    expect(result.exitCode).toBe(0);
    expect(routes()).toEqual([['POST', '/v1/sandboxes'], ['DELETE', `/v1/sandboxes/${SBX}`]]);
  });

  it('keeps sandboxId the placeholder; getInfo().id and getInstance().id are the real id once created', async () => {
    const sandbox = await provider().sandbox.create();
    const placeholder = sandbox.sandboxId;
    expect(sandbox.getInstance().id).toBe(placeholder);
    api.reply(created(), json(200, { ...RECORD, state: 'ready' }));
    const info = await sandbox.getInfo();
    expect(info.id).toBe(SBX);
    expect(sandbox.sandboxId).toBe(placeholder);
    expect(sandbox.instanceId).toBe(placeholder);
    expect(sandbox.getInstance().id).toBe(SBX);
    // getInfo creates without a command: a plain create, then the record.
    expect(routes()).toEqual([['POST', '/v1/sandboxes'], ['GET', `/v1/sandboxes/${SBX}`]]);
    expect(bodyOf(api.requests[0])).toEqual({ session: 'headless' });
  });

  it('creates the sandbox before any other first call does its own work', async () => {
    api.otherwise((seen) => (seen.path === '/v1/sandboxes' ? created() : json(200, { path: 'a.txt', bytes: 1 })));
    const writer = await provider().sandbox.create();
    await writer.filesystem.writeFile('a.txt', 'a');
    expect(routes()).toEqual([['POST', '/v1/sandboxes'], ['PUT', `/v1/sandboxes/${SBX}/files?path=a.txt`]]);

    const prober = await provider().sandbox.create();
    await expect(prober.getUrl({ port: 3000 })).rejects.toThrow(/does not support getUrl/);
    expect(routes().slice(2)).toEqual([['POST', '/v1/sandboxes']]);
  });

  it('refuses a call that is wrong in itself without creating the sandbox', async () => {
    const sandbox = await provider().sandbox.create();
    await expect(sandbox.filesystem.readFile('/etc/hosts')).rejects.toThrow(/relative to the sandbox root/);
    expect(api.requests).toHaveLength(0);
  });

  it('a filesystem call that runs as a command rides the create too', async () => {
    const sandbox = await provider().sandbox.create();
    api.reply(created(FINISHED));
    await sandbox.filesystem.mkdir('out');
    expect(routes()).toEqual([['POST', '/v1/sandboxes']]);
    expect(bodyOf(api.requests[0]).run).toEqual({ cmd: 'mkdir -p -- "out"' });
  });

  it('concurrent first calls share one create', async () => {
    const sandbox = await provider().sandbox.create();
    api.otherwise((seen) => {
      if (seen.path === '/v1/sandboxes') return { status: 201, json: { ...RECORD, run: FINISHED }, delayMs: 20 };
      if (seen.method === 'GET') return json(200, { ...RECORD, state: 'ready' });
      return json(200, { path: 'a.txt', bytes: 1 });
    });
    const [result, info] = await Promise.all([sandbox.runCommand('node -v'), sandbox.getInfo(), sandbox.filesystem.writeFile('a.txt', 'a')]);
    expect(result.stdout).toBe('v24.1.0\n');
    expect(info.id).toBe(SBX);
    expect(api.requests.filter(({ path }) => path === '/v1/sandboxes')).toHaveLength(1);
    expect(bodyOf(api.requests[0]).run).toEqual({ cmd: 'node -v' });
    expect(api.requests).toHaveLength(3);
  });

  it('a call waiting on a first command the API refused creates the sandbox without it', async () => {
    const sandbox = await provider().sandbox.create();
    api.otherwise((seen) => {
      if (seen.path !== '/v1/sandboxes') return json(200, { ...RECORD, state: 'ready' });
      return bodyOf(seen).run === undefined
        ? created()
        : { status: 400, json: { error: { code: 'bad-envs', message: 'run.envs.1X must be a variable name with a string value' } }, delayMs: 20 };
    });
    const [refused, info] = await Promise.all([
      sandbox.runCommand('true', { env: { '1X': 'y' } }).catch((e) => e),
      sandbox.getInfo(),
    ]);
    expect(refused).toMatchObject({ status: 400, code: 'bad-envs' });
    expect(info.id).toBe(SBX);
    expect(routes()).toEqual([['POST', '/v1/sandboxes'], ['POST', '/v1/sandboxes'], ['GET', `/v1/sandboxes/${SBX}`]]);
  });

  it('getById of a placeholder creates the sandbox and returns the real one', async () => {
    const compute = provider();
    const sandbox = await compute.sandbox.create();
    api.reply(created(), json(200, { ...RECORD, state: 'ready' }));
    const found = await compute.sandbox.getById(sandbox.sandboxId);
    expect(found?.sandboxId).toBe(SBX);
    expect(routes()).toEqual([['POST', '/v1/sandboxes'], ['GET', `/v1/sandboxes/${SBX}`]]);
  });

  it('a placeholder is only honoured for the API key that created it', async () => {
    const sandbox = await provider().sandbox.create();
    api.reply(failure(404, 'not-found', 'no such sandbox'));
    await offstage({ apiKey: 'sk_offstage_other', baseUrl: api.url }).sandbox.destroy(sandbox.sandboxId);
    // Sent as an ordinary id, which names nothing; the handle is untouched.
    expect(routes()).toEqual([['DELETE', `/v1/sandboxes/${sandbox.sandboxId}`]]);
    api.reply(created(FINISHED));
    expect((await sandbox.runCommand('node -v')).exitCode).toBe(0);
  });

  describe('switch', () => {
    it('is off by default: create() is the create request', async () => {
      api.reply(created());
      expect((await provider({}).sandbox.create()).sandboxId).toBe(SBX);
      expect(routes()).toEqual([['POST', '/v1/sandboxes']]);
    });

    it.each(['1', 'true', ' TRUE '])('OFFSTAGE_LAZY_CREATE=%j turns it on', async (value) => {
      vi.stubEnv('OFFSTAGE_LAZY_CREATE', value);
      expect((await provider({}).sandbox.create()).sandboxId).toMatch(PLACEHOLDER);
      expect(api.requests).toHaveLength(0);
    });

    it('lazyCreate: false wins over the environment', async () => {
      vi.stubEnv('OFFSTAGE_LAZY_CREATE', '1');
      api.reply(created());
      expect((await provider({ lazyCreate: false }).sandbox.create()).sandboxId).toBe(SBX);
    });

    it('refuses a value it does not know', async () => {
      vi.stubEnv('OFFSTAGE_LAZY_CREATE', 'yes');
      await expect(provider({}).sandbox.create()).rejects.toThrow('OFFSTAGE_LAZY_CREATE must be 1, true, 0 or false, not "yes"');
      expect(api.requests).toHaveLength(0);
    });
  });
});
