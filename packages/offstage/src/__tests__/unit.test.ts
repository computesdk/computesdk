import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { INSTANCE_SIZE_PROFILES, InstanceSizeError, type InstanceSizeClass } from 'computesdk';
import { offstage, OffstageError } from '../index';
import { failure, json, startApi, until, type FakeApi, type Seen } from './fake-api';

// Every test runs against a local stand-in for the API (fake-api.ts), over the
// provider's real HTTP/2 transport: nothing here reaches Offstage.
const SBX = 'sbx_test1';
const RECORD = {
  id: SBX, name: 'swift-otter', session: 'headless', state: 'pending',
  createdAt: 1793000000000, expiresAt: 1793000900000, timeoutMs: 900000, idleTimeoutMs: 600000,
};
const FINISHED = { commandId: 'cmd_1', state: 'finished', exitCode: 0, timedOut: false, stdout: 'v24.1.0\n', stderr: '', truncated: false, durationMs: 12 };

describe('Offstage provider (local API)', () => {
  let api: FakeApi;
  const provider = (config: { session?: 'headless' | 'gui' } = {}) => offstage({ apiKey: 'sk_offstage_test', baseUrl: api.url, ...config });
  /** Every request after the create. */
  const calls = () => api.requests.slice(1);
  const routes = (seen: Seen[]) => seen.map(({ method, path }) => [method, path]);
  const bodyOf = (seen: Seen) => JSON.parse(seen.body);

  const createSandbox = async () => {
    api.reply(json(201, RECORD));
    return provider().sandbox.create();
  };

  beforeEach(async () => {
    api = await startApi();
  });

  afterEach(async () => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    await api.close();
  });

  describe('create', () => {
    it('is exactly one request and does not wait for the pending sandbox', async () => {
      const sandbox = await createSandbox();
      expect(sandbox.sandboxId).toBe(SBX);
      expect(api.requests).toHaveLength(1);
      const [seen] = api.requests;
      expect([seen.method, seen.path]).toEqual(['POST', '/v1/sandboxes']);
      expect(seen.headers.authorization).toBe('Bearer sk_offstage_test');
      expect(seen.headers['idempotency-key']).toMatch(/^[0-9a-f-]{36}$/);
      expect(seen.headers['content-type']).toBe('application/json');
      expect(bodyOf(seen)).toEqual({ session: 'headless' });
    });

    it('maps timeout, name and session', async () => {
      api.otherwise(() => json(201, RECORD));
      await provider({ session: 'gui' }).sandbox.create({ timeout: 1_800_000, name: 'ios-build' });
      expect(bodyOf(api.requests[0])).toEqual({ session: 'gui', timeoutMs: 1_800_000, name: 'ios-build' });
      await provider({ session: 'gui' }).sandbox.create({ session: 'headless' });
      expect(bodyOf(api.requests[1])).toEqual({ session: 'headless' });
    });

    it('reads the key and URL from the environment', async () => {
      vi.stubEnv('OFFSTAGE_API_KEY', 'sk_offstage_env');
      vi.stubEnv('OFFSTAGE_API_URL', `${api.url}/`);
      api.reply(json(201, RECORD));
      await offstage({}).sandbox.create();
      expect(api.requests[0].path).toBe('/v1/sandboxes');
      expect(api.requests[0].headers.authorization).toBe('Bearer sk_offstage_env');
    });

    it('fails without a key before calling the API', async () => {
      vi.stubEnv('OFFSTAGE_API_KEY', '');
      await expect(offstage({ baseUrl: api.url }).sandbox.create()).rejects.toThrow(/Missing Offstage API key[\s\S]*OFFSTAGE_API_KEY/);
      expect(api.requests).toHaveLength(0);
    });
  });

  describe('runCommand', () => {
    it('is exactly one request when the command ends within the hold', async () => {
      const sandbox = await createSandbox();
      api.reply(json(200, FINISHED));
      const result = await sandbox.runCommand('node -v');
      expect(result).toMatchObject({ stdout: 'v24.1.0\n', stderr: '', exitCode: 0 });
      expect(routes(calls())).toEqual([['POST', `/v1/sandboxes/${SBX}/commands`]]);
      expect(bodyOf(calls()[0])).toEqual({ cmd: 'node -v' });
    });

    it('maps env to envs, timeout to timeoutMs and a relative cwd to cwd', async () => {
      const sandbox = await createSandbox();
      api.reply(json(200, FINISHED));
      await sandbox.runCommand('swift build', { cwd: 'src/app', env: { CI: '1' }, timeout: 60_000 });
      expect(bodyOf(calls()[0])).toEqual({ cmd: 'swift build', cwd: 'src/app', envs: { CI: '1' }, timeoutMs: 60_000 });
    });

    it('enters an absolute cwd through the shell', async () => {
      const sandbox = await createSandbox();
      api.reply(json(200, FINISHED));
      await sandbox.runCommand('pwd; ls', { cwd: '/tmp/my "dir"' });
      expect(bodyOf(calls()[0])).toEqual({ cmd: 'cd "/tmp/my \\"dir\\"" || exit 1\npwd; ls' });
    });

    it('follows a 202 with GET ?wait=50 until the command ends', async () => {
      const sandbox = await createSandbox();
      const running = { commandId: 'cmd_1', state: 'running', startedAt: 1793000000000 };
      api.reply(json(202, running), json(202, running), json(200, { ...FINISHED, exitCode: 3, stdout: 'done\n' }));
      const result = await sandbox.runCommand('xcodebuild test');
      expect(result).toMatchObject({ stdout: 'done\n', exitCode: 3 });
      const follow = `/v1/sandboxes/${SBX}/commands/cmd_1?wait=50`;
      expect(routes(calls())).toEqual([['POST', `/v1/sandboxes/${SBX}/commands`], ['GET', follow], ['GET', follow]]);
    });

    it('sends the command again on 409 sandbox-not-ready', async () => {
      const sandbox = await createSandbox();
      api.reply(failure(409, 'sandbox-not-ready', 'still waiting for a free Mac slot'), json(200, FINISHED));
      const result = await sandbox.runCommand('node -v');
      expect(result.exitCode).toBe(0);
      expect(calls().map(({ method }) => method)).toEqual(['POST', 'POST']);
      expect(calls()[1].body).toBe(calls()[0].body);
    });

    it('waits out a 429 rate-limit for its Retry-After seconds', async () => {
      const sandbox = await createSandbox();
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      api.reply(failure(429, 'rate-limit', 'more than 120 requests in the last 60 s', {}, { 'retry-after': '7' }), json(200, FINISHED));
      const pending = sandbox.runCommand('node -v');
      await until(() => calls().length === 1);
      // Let the 429 reach the provider and its wait begin.
      await until(() => vi.getTimerCount() > 0);
      await vi.advanceTimersByTimeAsync(6_999);
      expect(calls()).toHaveLength(1);
      await vi.advanceTimersByTimeAsync(1);
      expect((await pending).exitCode).toBe(0);
      expect(calls()).toHaveLength(2);
    });

    it('throws a 429 that carries no Retry-After', async () => {
      const sandbox = await createSandbox();
      api.reply(failure(429, 'rate-limit', 'slow down'));
      await expect(sandbox.runCommand('node -v')).rejects.toThrow(/Offstage 429 rate-limit/);
      expect(calls()).toHaveLength(1);
    });

    it('reports a command killed at its timeout as exit code 124', async () => {
      const sandbox = await createSandbox();
      api.reply(json(200, { ...FINISHED, exitCode: null, timedOut: true, stdout: 'partial' }));
      expect(await sandbox.runCommand('sleep 600', { timeout: 1000 })).toMatchObject({ exitCode: 124, stdout: 'partial' });
    });

    it('refuses background commands without calling the API', async () => {
      const sandbox = await createSandbox();
      await expect(sandbox.runCommand('sleep 5', { background: true })).rejects.toThrow(/does not support background commands/);
      expect(calls()).toHaveLength(0);
    });
  });

  describe('errors', () => {
    it('surfaces the error envelope: status, code, message, fix and request id', async () => {
      const sandbox = await createSandbox();
      api.reply(failure(409, 'sandbox-closed', `sandbox ${SBX} is closed (idle)`, { fix: 'create a new sandbox' }));
      const error = await sandbox.runCommand('true').catch((e) => e);
      expect(error).toBeInstanceOf(OffstageError);
      expect(error).toMatchObject({ status: 409, code: 'sandbox-closed', fix: 'create a new sandbox', requestId: 'req_9' });
      expect(error.message).toBe(`Offstage 409 sandbox-closed: sandbox ${SBX} is closed (idle) Fix: create a new sandbox. (request req_9)`);
    });

    it('surfaces a create refusal', async () => {
      api.reply(failure(402, 'payment-method-required', 'not enough credit', { fix: 'buy credit in the console under Billing' }));
      await expect(provider().sandbox.create())
        .rejects.toThrow('Offstage 402 payment-method-required: not enough credit Fix: buy credit in the console under Billing.');
    });

    it('reports a failure whose body is not JSON', async () => {
      const sandbox = await createSandbox();
      api.reply({ status: 502, text: '<html>bad gateway</html>', headers: { 'x-request-id': 'req_p' } });
      await expect(sandbox.runCommand('true')).rejects.toThrow('Offstage 502 http-error: <html>bad gateway</html> (request req_p)');
    });
  });

  describe('filesystem', () => {
    const files = (path: string) => `/v1/sandboxes/${SBX}/files?path=${encodeURIComponent(path)}`;

    it('writes a sandbox-relative path with one PUT to the file route', async () => {
      const sandbox = await createSandbox();
      api.reply(json(200, { path: 'src/hello.swift', bytes: 14 }));
      await sandbox.filesystem.writeFile('src/hello.swift', 'print("hello")');
      expect(routes(calls())).toEqual([['PUT', files('src/hello.swift')]]);
      expect(calls()[0].body).toBe('print("hello")');
      expect(calls()[0].headers['content-type']).toBe('application/octet-stream');
    });

    it('reads a sandbox-relative path with one GET to the file route', async () => {
      const sandbox = await createSandbox();
      api.reply({ status: 200, text: 'build ok\n' });
      expect(await sandbox.filesystem.readFile('src/build.log')).toBe('build ok\n');
      expect(routes(calls())).toEqual([['GET', files('src/build.log')]]);
    });

    it('throws when the file does not exist', async () => {
      const sandbox = await createSandbox();
      api.reply(failure(404, 'file-not-found', 'missing.txt is not a file'));
      await expect(sandbox.filesystem.readFile('missing.txt')).rejects.toThrow(/Offstage 404 file-not-found/);
    });

    it('retries a file op on 409 sandbox-not-ready', async () => {
      const sandbox = await createSandbox();
      api.reply(failure(409, 'sandbox-not-ready', 'still waiting'), json(200, { path: 'a.txt', bytes: 1 }));
      await sandbox.filesystem.writeFile('a.txt', 'a');
      expect(calls().map(({ method }) => method)).toEqual(['PUT', 'PUT']);
    });

    it('refuses an absolute path without calling the API', async () => {
      const sandbox = await createSandbox();
      await expect(sandbox.filesystem.readFile('/nonexistent/file.txt')).rejects.toThrow(/relative to the sandbox root, not the absolute path \/nonexistent\/file.txt/);
      await expect(sandbox.filesystem.writeFile('/tmp/a.txt', 'a')).rejects.toThrow(/relative to the sandbox root/);
      expect(calls()).toHaveLength(0);
    });

    it('getById costs one request: the framework\'s absolute-path probe never reaches the API', async () => {
      api.reply(json(200, RECORD));
      expect((await provider().sandbox.getById(SBX))?.sandboxId).toBe(SBX);
      expect(api.requests).toHaveLength(1);
    });

    it('runs mkdir, exists and remove through the shell with quoted paths', async () => {
      const sandbox = await createSandbox();
      api.reply(json(200, FINISHED), json(200, { ...FINISHED, exitCode: 1 }), json(200, FINISHED));
      await sandbox.filesystem.mkdir('a $b/c');
      expect(await sandbox.filesystem.exists('a "b"')).toBe(false);
      await sandbox.filesystem.remove('/tmp/`x`');
      expect(calls().map((seen) => bodyOf(seen).cmd)).toEqual([
        'mkdir -p -- "a \\$b/c"', 'test -e "a \\"b\\""', 'rm -rf -- "/tmp/\\`x\\`"',
      ]);
    });

    it('lists a directory from stat output', async () => {
      const sandbox = await createSandbox();
      api.reply(json(200, {
        ...FINISHED,
        stdout: 'Regular File\t8\t1793000000\tsrc/file1.txt\nDirectory\t96\t1793000100\tsrc/sub dir\n',
      }));
      const entries = await sandbox.filesystem.readdir('src');
      expect(bodyOf(calls()[0]).cmd).toBe(`find "src" -mindepth 1 -maxdepth 1 -exec stat -f '%HT%t%z%t%m%t%N' {} +`);
      expect(entries).toEqual([
        { name: 'file1.txt', type: 'file', size: 8, modified: new Date(1793000000000) },
        { name: 'sub dir', type: 'directory', size: 96, modified: new Date(1793000100000) },
      ]);
    });

    it('throws when a directory cannot be listed', async () => {
      const sandbox = await createSandbox();
      api.reply(json(200, { ...FINISHED, exitCode: 1, stdout: '', stderr: 'find: nope: No such file or directory\n' }));
      await expect(sandbox.filesystem.readdir('nope')).rejects.toThrow(/failed to list directory nope: find: nope/);
    });
  });

  describe('lifecycle', () => {
    it('getById returns the sandbox, or null on 404', async () => {
      api.reply(json(200, { ...RECORD, state: 'ready' }), failure(404, 'not-found', 'no such sandbox'));
      expect((await provider().sandbox.getById(SBX))?.sandboxId).toBe(SBX);
      expect(await provider().sandbox.getById('sbx_gone')).toBeNull();
      expect(api.requests[0].path).toBe(`/v1/sandboxes/${SBX}`);
    });

    it('list returns pending and ready sandboxes across pages', async () => {
      api.reply(
        json(200, { sandboxes: [{ ...RECORD, id: 'sbx_p' }], nextCursor: null }),
        json(200, { sandboxes: [{ ...RECORD, id: 'sbx_a', state: 'ready' }], nextCursor: 'sbx_a' }),
        json(200, { sandboxes: [{ ...RECORD, id: 'sbx_b', state: 'ready' }], nextCursor: null }),
      );
      const sandboxes = await provider().sandbox.list();
      expect(sandboxes.map((s) => s.sandboxId)).toEqual(['sbx_p', 'sbx_a', 'sbx_b']);
      expect(api.requests.map(({ path }) => path)).toEqual([
        '/v1/sandboxes?state=pending&limit=200',
        '/v1/sandboxes?state=ready&limit=200',
        '/v1/sandboxes?state=ready&limit=200&cursor=sbx_a',
      ]);
    });

    it('destroy deletes the sandbox and accepts one that is already gone', async () => {
      api.reply(json(200, { ...RECORD, state: 'closed', closeReason: 'deleted' }), failure(404, 'not-found', 'no such sandbox'));
      await provider().sandbox.destroy(SBX);
      await provider().sandbox.destroy('sbx_gone');
      expect(routes(api.requests)).toEqual([['DELETE', `/v1/sandboxes/${SBX}`], ['DELETE', '/v1/sandboxes/sbx_gone']]);
    });

    it('getInfo maps the sandbox record', async () => {
      const sandbox = await createSandbox();
      api.reply(json(200, { ...RECORD, state: 'ready' }));
      expect(await sandbox.getInfo()).toMatchObject({
        id: SBX, provider: 'offstage', status: 'running', createdAt: new Date(1793000000000), timeout: 900000,
        metadata: { name: 'swift-otter', session: 'headless', state: 'ready' },
      });
      api.reply(json(200, { ...RECORD, state: 'closed', closeReason: 'idle' }));
      expect(await sandbox.getInfo()).toMatchObject({ status: 'stopped', metadata: { closeReason: 'idle' } });
    });

    it('getUrl throws: sandboxes expose no ports', async () => {
      const sandbox = await createSandbox();
      await expect(sandbox.getUrl({ port: 3000 })).rejects.toThrow(/does not support getUrl/);
      expect(calls()).toHaveLength(0);
    });
  });

  describe('standard sizes', () => {
    const CLASSES = Object.keys(INSTANCE_SIZE_PROFILES) as InstanceSizeClass[];

    it.each(CLASSES)('resolves %s as unsupported with the fixed-shape reason', (sizeClass) => {
      const resolution = provider().sizes.resolve(sizeClass);
      expect(resolution.status).toBe('unsupported');
      expect((resolution as { reason: string }).reason).toMatch(/one fixed shape.*no CPU, memory or disk fields/);
    });

    it('refuses create({ sizeClass }) without calling the API', async () => {
      const error = await provider().sandbox.create({ sizeClass: 'md' }).catch((e) => e);
      expect(error).toBeInstanceOf(InstanceSizeError);
      expect(error.code).toBe('unsupported');
      expect(api.requests).toHaveLength(0);
    });
  });
});
