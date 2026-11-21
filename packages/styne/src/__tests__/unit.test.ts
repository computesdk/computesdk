import http2 from 'node:http2';
import type { AddressInfo } from 'node:net';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { closeSessions, DEFAULT_API_URL, IDLE_SESSION_MS, KEEPALIVE_MS, request, StyneApiError } from '../client';
import { createBody, execRequest, ExecOutput, resolveConfig, styne, TIMEOUT_EXIT_CODE } from '../provider';
import type { StyneTemplateOptions } from '../provider';

const frame = (value: object) => Buffer.from(JSON.stringify(value) + '\n');
const b64 = (text: string | Buffer) => Buffer.from(text).toString('base64');

describe('resolveConfig', () => {
  const saved = { key: process.env.STYNE_API_KEY, url: process.env.STYNE_API_URL };

  afterEach(() => {
    if (saved.key === undefined) delete process.env.STYNE_API_KEY;
    else process.env.STYNE_API_KEY = saved.key;
    if (saved.url === undefined) delete process.env.STYNE_API_URL;
    else process.env.STYNE_API_URL = saved.url;
  });

  it('explains how to get a key when none is set', () => {
    delete process.env.STYNE_API_KEY;
    expect(() => resolveConfig({})).toThrow(/Missing Styne API key[\s\S]*STYNE_API_KEY/);
  });

  it('falls back to the environment and the default API URL', () => {
    process.env.STYNE_API_KEY = 'env-key';
    delete process.env.STYNE_API_URL;
    expect(resolveConfig({})).toEqual({ apiKey: 'env-key', apiUrl: DEFAULT_API_URL });
    expect(resolveConfig({ apiKey: 'given' }).apiKey).toBe('given');
    process.env.STYNE_API_URL = 'https://eu.example.test';
    expect(resolveConfig({}).apiUrl).toBe('https://eu.example.test');
  });

  it('rejects an API URL that does not parse', () => {
    expect(() => resolveConfig({ apiKey: 'k', apiUrl: 'not a url' })).toThrow(/Invalid Styne API URL/);
  });

  it('refuses plain HTTP except to the local machine', () => {
    expect(() => resolveConfig({ apiKey: 'k', apiUrl: 'http://api.example.test' })).toThrow(/must use https/);
    expect(() => resolveConfig({ apiKey: 'k', apiUrl: 'ftp://api.example.test' })).toThrow(/must use https/);
    for (const apiUrl of ['http://localhost:8080', 'http://127.0.0.1:9000', 'http://[::1]:9000']) {
      expect(resolveConfig({ apiKey: 'k', apiUrl }).apiUrl).toBe(apiUrl);
    }
  });
});

describe('createBody', () => {
  it('maps create options to the API fields', () => {
    const body = createBody({ timeout: 60_000 }, {
      templateId: 'base',
      envs: { A: '1' },
      metadata: { team: 'core', attempt: 2 },
      name: 'worker',
      volumes: [
        { volume: { id: 'vol-1', name: 'data' }, mountPath: '/mnt/data' },
        { volume: 'cache', mountPath: '/mnt/cache', readOnly: true },
      ],
    });
    expect(body).toEqual({
      templateID: 'base',
      timeout: 60,
      envVars: { A: '1' },
      metadata: { team: 'core', attempt: '2', name: 'worker' },
      volumeMounts: [
        { name: 'data', path: '/mnt/data', readOnly: false },
        { name: 'cache', path: '/mnt/cache', readOnly: true },
      ],
    });
  });

  it('prefers a snapshot over an image over a template and caps the lifetime', () => {
    expect(createBody({}, { snapshotId: 's', image: 'alpine', templateId: 't' })).toEqual({ snapshot: 's' });
    expect(createBody({}, { image: 'alpine', templateId: 't' })).toEqual({ image: 'alpine' });
    expect(createBody({}, { timeout: 10 * 86_400_000 }).timeout).toBe(86_400);
    expect(createBody({}, {})).toEqual({});
  });
});

describe('execRequest', () => {
  it('runs the command through sh with its options', () => {
    const line = execRequest('echo "$HOME"', { cwd: '/srv', env: { A: 'b' }, timeout: 5000 });
    expect(line.endsWith('\n')).toBe(true);
    expect(JSON.parse(line)).toEqual({ cmd: 'sh', args: ['-c', 'echo "$HOME"'], cwd: '/srv', env: { A: 'b' }, timeoutMs: 5000 });
  });

  it('detaches a background command and escapes it', () => {
    const { args, timeoutMs } = JSON.parse(execRequest('sleep 9; echo "$X"', { background: true, timeout: 5000 }));
    expect(args[1]).toBe('nohup sh -c "sleep 9; echo \\"\\$X\\"" >/dev/null 2>&1 &');
    expect(timeoutMs).toBeUndefined();
  });
});

describe('ExecOutput', () => {
  it('reads frames split across chunks and keeps UTF-8 intact across output frames', () => {
    const seen: string[] = [];
    const output = new ExecOutput({ onStdout: (text) => seen.push(text) });
    const euro = Buffer.from('€');
    const body = Buffer.concat([
      frame({ started: { pid: 7 } }),
      frame({ stdout: b64(Buffer.concat([Buffer.from('a'), euro.subarray(0, 1)])) }),
      frame({ stdout: b64(euro.subarray(1)) }),
      frame({ stderr: b64('warn') }),
      frame({ exit: { exitCode: 3, signal: 0, timedOut: false } }),
    ]);
    for (let i = 0; i < body.length; i += 5) output.push(body.subarray(i, i + 5));
    output.end();
    expect(output.stdout).toBe('a€');
    expect(seen.join('')).toBe('a€');
    expect(output.stderr).toBe('warn');
    expect(output.exitCode).toBe(3);
  });

  it('reports a command stopped at its timeout with the timeout exit code', () => {
    const output = new ExecOutput();
    output.push(frame({ exit: { exitCode: -1, signal: 9, timedOut: true } }));
    output.push(frame({ error: { error_code: 'command_timeout', message: 'timed out' } }));
    output.end();
    expect(output.exitCode).toBe(TIMEOUT_EXIT_CODE);
    expect(output.failure).toBeUndefined();
  });

  it('rejects a line that is not JSON with a StyneApiError', () => {
    const output = new ExecOutput();
    expect(() => output.push(Buffer.from('<html>proxy error</html>\n'))).toThrow(StyneApiError);
    const last = new ExecOutput();
    last.push(Buffer.from('{"stdout":'));
    expect(() => last.end()).toThrow(/not JSON/);
  });
});

describe('provider over HTTP/2', () => {
  let server: http2.Http2Server;
  let connections = 0;
  const requests: Array<{ method: string; path: string; body: string; auth?: string; contentType?: string }> = [];

  beforeAll(async () => {
    server = http2.createServer();
    server.on('session', () => connections++);
    server.on('stream', (stream, headers) => {
      stream.on('error', () => undefined);
      const chunks: Buffer[] = [];
      stream.on('data', (chunk: Buffer) => chunks.push(chunk));
      stream.on('end', () => {
        const method = String(headers[':method']);
        const path = String(headers[':path']);
        const body = Buffer.concat(chunks).toString('utf8');
        requests.push({
          method,
          path,
          body,
          auth: headers.authorization as string | undefined,
          contentType: headers['content-type'] as string | undefined,
        });
        const json = (status: number, value: unknown) => {
          stream.respond({ ':status': status, 'content-type': 'application/json' });
          stream.end(JSON.stringify(value));
        };
        const empty = (status: number) => {
          stream.respond({ ':status': status });
          stream.end();
        };
        if (path === '/hang') return;
        if (method === 'POST' && path === '/sandboxes') {
          const parsed = JSON.parse(body);
          if (parsed.templateID === 'saved-env') return json(404, { code: 404, error_code: 'not_found', message: 'no template' });
          if (parsed.templateID === 'over-limit') {
            return json(429, { code: 429, error_code: 'resident_limit', message: 'too many sandboxes', request_id: 'req-1' });
          }
          if (parsed.templateID === 'template-source') return json(201, { sandboxID: 'sbx-tpl' });
          return json(201, { sandboxID: 'sbx-1', domain: 'sandbox.example.test' });
        }
        if (method === 'POST' && path === '/sandboxes/sbx-1/exec') {
          stream.respond({ ':status': 200, 'content-type': 'application/x-ndjson' });
          if (JSON.parse(body).args[1] === 'proxy-error') {
            stream.write('<html>proxy error</html>\n');
            setTimeout(() => stream.end(frame({ exit: { exitCode: 0 } })), 50);
            return;
          }
          stream.write(frame({ started: { pid: 1 } }));
          stream.write(frame({ stdout: b64('hello\n') }));
          stream.end(frame({ exit: { exitCode: 0 } }));
          return;
        }
        if (method === 'GET' && path === '/sandboxes') {
          return json(200, [{ sandboxID: 'sbx-1', domain: 'sandbox.example.test' }, { sandboxId: 'sbx-2' }]);
        }
        if (method === 'POST' && path === '/sandboxes/sbx-1/pause') return empty(204);
        if (method === 'POST' && path === '/sandboxes/sbx-1/resume') return json(201, { sandboxID: 'sbx-1', timeout: 3600 });
        if (method === 'POST' && path === '/sandboxes/sbx-1/refreshes') return empty(204);
        if (method === 'GET' && path === '/sandboxes/sbx-1/files/list?path=%2Froot') {
          return json(200, {
            entries: [
              { name: 'notes', path: '/root/notes', size: 4, type: 'file' },
              { name: 'src', path: '/root/src', type: 'dir', modified: '2026-01-02T03:04:05Z' },
            ],
          });
        }
        if (method === 'POST' && path === '/sandboxes/sbx-tpl/snapshots') {
          if (JSON.parse(body).name === 'broken') return json(500, { code: 500, message: 'snapshot store unavailable' });
          return json(201, { snapshotID: 'snap-1', names: ['ready'], name: 'ready', created: 1_767_225_600 });
        }
        if (method === 'DELETE' && path === '/sandboxes/sbx-tpl') return json(503, { code: 503, message: 'busy' });
        if (method === 'GET' && path === '/sandboxes/sbx-1') {
          return json(200, { sandboxID: 'sbx-1', state: 'paused', domain: 'sandbox.example.test', startedAt: '2026-01-01T00:00:00Z', endAt: '2026-01-01T00:05:00Z' });
        }
        if (method === 'GET' && path === '/sandboxes/missing') return json(404, { code: 404, message: 'not found' });
        if (method === 'DELETE' && path === '/sandboxes/sbx-1') {
          stream.respond({ ':status': 204 });
          stream.end();
          return;
        }
        json(500, { code: 500, message: `unexpected ${method} ${path}` });
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  });

  afterAll(async () => {
    closeSessions();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  const provider = () => {
    const { port } = server.address() as AddressInfo;
    return styne({ apiKey: 'test-key', apiUrl: `http://127.0.0.1:${port}` });
  };

  it('creates, runs a command, reads info and destroys over one connection', async () => {
    const compute = provider();
    const before = connections;
    const sandbox = await compute.instances.create({ templateId: 'base' });
    const result = await sandbox.runCommand('echo hello');
    expect(result.stdout).toBe('hello\n');
    expect(result.exitCode).toBe(0);
    const info = await sandbox.getInfo();
    expect(info.status).toBe('stopped');
    expect(info.timeout).toBe(300_000);
    expect(await sandbox.getUrl({ port: 3000 })).toBe('https://3000-sbx-1.sandbox.example.test');
    await sandbox.destroy();
    expect(await compute.instances.getById('missing')).toBeNull();
    expect(connections - before).toBeLessThanOrEqual(1);
    expect(requests.every((r) => r.auth === 'Bearer test-key')).toBe(true);
    expect(JSON.parse(requests.find((r) => r.path === '/sandboxes/sbx-1/exec')!.body).args).toEqual(['-c', 'echo hello']);
  });

  it('starts a saved template from its snapshot', async () => {
    requests.length = 0;
    const sandbox = await provider().instances.create({ templateId: 'saved-env' });
    expect(sandbox.instanceId).toBe('sbx-1');
    expect(requests.map((r) => JSON.parse(r.body))).toEqual([{ templateID: 'saved-env' }, { snapshot: 'saved-env' }]);
  });

  it('turns an API error into a StyneApiError with its code', async () => {
    const error = await provider().instances.create({ templateId: 'over-limit' }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(StyneApiError);
    expect(error).toMatchObject({ status: 429, code: 'resident_limit', requestId: 'req-1' });
    expect((error as Error).message).toContain('too many sandboxes');
  });

  it('rejects a command whose answer has a line that is not JSON', async () => {
    const sandbox = await provider().instances.create();
    const error = await sandbox.runCommand('proxy-error').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(StyneApiError);
    expect((error as Error).message).toMatch(/not JSON/);
    expect((await sandbox.runCommand('echo hello')).stdout).toBe('hello\n');
  });

  it('rejects a command whose output callback throws', async () => {
    const sandbox = await provider().instances.create();
    const run = sandbox.runCommand('echo hello', {
      onStdout: () => {
        throw new Error('callback boom');
      },
    });
    await expect(run).rejects.toThrow('callback boom');
    expect((await sandbox.runCommand('echo hello')).exitCode).toBe(0);
  });

  it('extends the lifetime without shortening it and resumes with the create lifetime', async () => {
    const sandbox = await provider().instances.create();
    requests.length = 0;
    await sandbox.extendLifetime!(90_500);
    await sandbox.extendLifetime!(10 * 86_400_000);
    await sandbox.pause!();
    await sandbox.resume!();
    expect(requests.map((r) => [r.path, r.body])).toEqual([
      ['/sandboxes/sbx-1/refreshes', '{"duration":91}'],
      ['/sandboxes/sbx-1/refreshes', '{"duration":86400}'],
      ['/sandboxes/sbx-1/pause', '{"tier":"memory"}'],
      ['/sandboxes/sbx-1/resume', ''],
    ]);
    expect(requests[3].contentType).toBeUndefined();
  });

  it('lists sandboxes under the id each one carries', async () => {
    const listed = await provider().instances.list();
    expect(listed.map((sandbox) => sandbox.instanceId)).toEqual(['sbx-1', 'sbx-2']);
  });

  it('leaves out the modified time when the API has none', async () => {
    const sandbox = await provider().instances.create();
    const entries = await sandbox.filesystem.readdir('/root');
    expect(entries).toEqual([
      { name: 'notes', type: 'file', size: 4 },
      { name: 'src', type: 'directory', size: 0, modified: new Date('2026-01-02T03:04:05Z') },
    ]);
  });

  it('returns a saved template even when its source sandbox cannot be destroyed', async () => {
    const compute = provider();
    const template = await compute.template!.create({ name: 'ready', templateId: 'template-source' } as StyneTemplateOptions);
    expect(template).toMatchObject({ id: 'ready', builtin: false });
    const error = await compute.template!.create({ name: 'broken', templateId: 'template-source' } as StyneTemplateOptions).catch((e: unknown) => e);
    expect((error as Error).message).toContain('snapshot store unavailable');
  });

  it('gives up on a request that gets no answer', async () => {
    const { port } = server.address() as AddressInfo;
    const config = { apiKey: 'test-key', apiUrl: `http://127.0.0.1:${port}` };
    requests.length = 0;
    const error = await request(config, 'POST', '/hang', { body: '{}', timeoutMs: 100 }).catch((e: unknown) => e);
    expect(error).toMatchObject({ code: 'ETIMEDOUT' });
    await expect(request(config, 'GET', '/sandboxes/sbx-1', { timeoutMs: 100 })).resolves.toMatchObject({ status: 200 });
  });

  it('keeps an idle session while it answers PINGs, and replaces one that does not', async () => {
    closeSessions();
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const connect = http2.connect;
    const opened: http2.ClientHttp2Session[] = [];
    const spy = vi.spyOn(http2, 'connect').mockImplementation(((...args: Parameters<typeof http2.connect>) => {
      const session = connect(...args);
      opened.push(session);
      return session;
    }) as typeof http2.connect);
    try {
      const compute = provider();
      await compute.instances.getById('missing');
      const ping = vi.spyOn(opened[0], 'ping');
      vi.advanceTimersByTime(KEEPALIVE_MS);
      expect(ping).toHaveBeenCalledTimes(1);
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(opened[0].destroyed).toBe(false);
      await compute.instances.getById('missing');
      expect(opened).toHaveLength(1);

      vi.spyOn(opened[0], 'ping').mockReturnValue(false);
      vi.advanceTimersByTime(KEEPALIVE_MS);
      expect(opened[0].destroyed).toBe(true);
      await compute.instances.getById('missing');
      expect(opened).toHaveLength(2);
    } finally {
      spy.mockRestore();
      vi.useRealTimers();
    }
  });

  it('closes a session after 5 minutes without a request', async () => {
    closeSessions();
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
    const connect = http2.connect;
    const opened: http2.ClientHttp2Session[] = [];
    const spy = vi.spyOn(http2, 'connect').mockImplementation(((...args: Parameters<typeof http2.connect>) => {
      const session = connect(...args);
      opened.push(session);
      return session;
    }) as typeof http2.connect);
    try {
      const compute = provider();
      await compute.instances.getById('missing');
      const closed = new Promise((resolve) => opened[0].once('close', resolve));
      vi.setSystemTime(Date.now() + IDLE_SESSION_MS);
      vi.advanceTimersByTime(KEEPALIVE_MS);
      await closed;
      await compute.instances.getById('missing');
      expect(opened).toHaveLength(2);
    } finally {
      spy.mockRestore();
      vi.useRealTimers();
    }
  });
});
