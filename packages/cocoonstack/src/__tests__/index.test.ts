import http from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Duplex } from 'node:stream';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const h2 = vi.hoisted(() => ({ connects: [] as string[] }));
vi.mock('node:http2', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:http2') & { default?: typeof import('node:http2') }>();
  const real = actual.connect as (...args: Parameters<typeof actual.connect>) => ReturnType<typeof actual.connect>;
  const connect = ((...args: Parameters<typeof actual.connect>) => {
    h2.connects.push(String(args[0]));
    return real(...args);
  }) as typeof actual.connect;
  return { ...actual, connect, default: { ...(actual.default ?? actual), connect } };
});
import { compute } from 'computesdk';
import { runProviderTestSuite } from '@computesdk/test-utils';
import { cocoonstack, CocoonstackApiError } from '../index.js';

interface Call {
  method: string;
  path: string;
  auth?: string;
  body?: Record<string, unknown>;
}

interface Rpc {
  auth?: string;
  request: Record<string, unknown>;
}

interface Fake {
  url: string;
  calls: Call[];
  rpcs: Rpc[];
  close: () => Promise<void>;
}

interface Outcome {
  stdout?: string;
  stderr?: string;
  exit?: number;
  error?: string;
  hang?: boolean;
}

const TOKEN = 'tok_1';
let flakyReleases = 0;

function frame(value: Record<string, unknown>): string {
  return `${JSON.stringify(value)}\n`;
}

function b64(text: string): string {
  return Buffer.from(text, 'utf8').toString('base64');
}

function outcome(request: Record<string, unknown>): Outcome {
  const argv = request.argv as string[];
  const command = argv[2] ?? '';
  if (command === 'node -v') return { stdout: 'v22.23.2\n', exit: 0 };
  if (command === 'exit 3') return { stderr: 'boom\n', exit: 3 };
  if (command === 'fail') return { error: 'internal: spawn failed' };
  if (command === 'hang') return { hang: true };
  if (command.startsWith('find "/list"')) {
    return {
      stdout: 'f\t6\t1757000000.5\tplain.txt\0d\t4096\t1757000001\tsub\0f\t0\t1757000002\todd\nname.txt\0',
      exit: 0,
    };
  }
  return { stdout: JSON.stringify({ command, cwd: request.cwd, env: request.env }), exit: 0 };
}

function respond(res: http.ServerResponse, status: number, body?: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(body === undefined ? undefined : JSON.stringify(body));
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((fulfill) => {
    let text = '';
    req.setEncoding('utf8');
    req.on('data', (chunk: string) => {
      text += chunk;
    });
    req.on('end', () => fulfill(text));
  });
}

async function fakeSandboxd(): Promise<Fake> {
  const calls: Call[] = [];
  const rpcs: Rpc[] = [];
  const relays = new Set<Duplex>();
  const server = http.createServer(async (req, res) => {
    const text = await readBody(req);
    const body = text ? (JSON.parse(text) as Record<string, unknown>) : undefined;
    const path = req.url ?? '';
    calls.push({ method: req.method ?? '', path, auth: req.headers.authorization, body });
    if (req.method === 'POST' && path === '/v1/claim') {
      if (body?.template === 'elsewhere:24.04') return respond(res, 200, { redirect: ['10.0.0.6:7777'] });
      if (body?.template === 'missing:24.04') return respond(res, 404, { error: 'unknown template' });
      const ttl = Number(body?.ttl_seconds ?? 300);
      const stale = body?.template === 'stale:24.04';
      const flaky = body?.template === 'flaky:24.04';
      return respond(res, 200, {
        id: flaky ? 'sb_flaky' : stale ? 'sb_2' : 'sb_1',
        token: flaky ? 'tok_flaky' : stale ? 'tok_2' : TOKEN,
        deadline: new Date(Date.now() + ttl * 1000).toISOString(),
        owner_addr: '10.0.0.5:7777',
      });
    }
    if (req.method === 'POST' && path === '/v1/sandboxes/sb_1/exec') {
      if (req.headers.authorization !== `Bearer ${TOKEN}`) return respond(res, 404, { error: 'unknown sandbox' });
      rpcs.push({ auth: req.headers.authorization, request: { op: 'exec', ...body } });
      const result = outcome(body ?? {});
      if (result.hang) {
        setTimeout(() => respond(res, 504, { error: 'command timed out' }), Number(body?.timeout_seconds ?? 1) * 1000);
        return;
      }
      if (result.error) return respond(res, 502, { error: result.error });
      if ((body?.argv as string[])[2] === 'huge') {
        return respond(res, 200, { exit_code: 0, stdout: 'x'.repeat(17 << 20), stderr: '' });
      }
      if ((body?.argv as string[])[2] === 'huge-utf8') {
        return respond(res, 200, { exit_code: 0, stdout: '\u20ac'.repeat(6 << 20), stderr: '' });
      }
      return respond(res, 200, { exit_code: result.exit ?? 0, stdout: result.stdout ?? '', stderr: result.stderr ?? '' });
    }
    if (req.method === 'POST' && path.endsWith('/exec')) return respond(res, 404, { error: 'unknown sandbox' });
    if (req.method === 'POST' && path === '/v1/sandboxes/sb_1/release') {
      return respond(res, req.headers.authorization === `Bearer ${TOKEN}` ? 204 : 404, undefined);
    }
    if (req.method === 'POST' && path === '/v1/sandboxes/sb_flaky/release') {
      flakyReleases += 1;
      if (flakyReleases === 1) return respond(res, 503, { error: 'node busy' });
      return respond(res, req.headers.authorization === 'Bearer tok_flaky' ? 204 : 404, undefined);
    }
    if (req.method === 'POST' && path.endsWith('/release')) return respond(res, 404, { error: 'unknown sandbox' });
    if (req.method === 'GET' && path === '/v1/sandboxes') {
      return respond(res, 200, {
        sandboxes: [
          { id: 'sb_1', key: { template: 'node-rt:24.04', net: 'none', size: 'small' }, deadline: '2026-01-01T00:05:00Z', hibernated: false },
          { id: 'sb_9', key: { template: 'node-rt:24.04', net: 'none', size: 'small' }, deadline: '2026-01-01T00:05:00Z', hibernated: false },
        ],
      });
    }
    if (req.method === 'POST' && path === '/v1/sandboxes/sb_1/preview') {
      return respond(res, 200, { url: `http://preview.test/p/${String(body?.port)}/` });
    }
    respond(res, 404, { error: 'no route' });
  });
  server.on('upgrade', (req, socket, head) => {
    if (req.url !== '/v1/sandboxes/sb_1/agent' || req.headers.authorization !== `Bearer ${TOKEN}`) {
      socket.end('HTTP/1.1 404 Not Found\r\ncontent-type: application/json\r\ncontent-length: 27\r\n\r\n{"error":"unknown sandbox"}');
      return;
    }
    relays.add(socket);
    socket.on('close', () => relays.delete(socket));
    socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: silkd\r\nConnection: Upgrade\r\n\r\n');
    let pending = head.toString('utf8');
    const onLine = (line: string) => {
      const request = JSON.parse(line) as Record<string, unknown>;
      rpcs.push({ auth: req.headers.authorization, request });
      if (request.detach) {
        socket.write(frame({ type: 'started', pid: 42 }));
        return;
      }
      socket.write(frame({ type: 'started', pid: 7 }));
      const command = (request.argv as string[])[2] ?? '';
      if (command === 'stream') {
        socket.write(frame({ type: 'stdout', data: b64('one\n') }));
        socket.write(frame({ type: 'stderr', data: b64('warn\n') }));
        socket.write(frame({ type: 'stdout', data: b64('two\n') }) + frame({ type: 'exit', code: 0 }));
        return;
      }
      if (command === 'truncated' || command === 'truncated-err-first') {
        const outFrame = frame({ type: 'stdout', data: Buffer.from('é', 'utf8').subarray(0, 1).toString('base64') });
        const errFrame = frame({ type: 'stderr', data: Buffer.from('ü', 'utf8').subarray(0, 1).toString('base64') });
        socket.write(command === 'truncated' ? outFrame + errFrame : errFrame + outFrame);
        socket.write(frame({ type: 'exit', code: 0 }));
        return;
      }
      if (command === 'split') {
        const bytes = Buffer.from('é', 'utf8');
        socket.write(frame({ type: 'stdout', data: bytes.subarray(0, 1).toString('base64') }));
        socket.write(frame({ type: 'stdout', data: bytes.subarray(1).toString('base64') }));
        socket.write(frame({ type: 'exit', code: 0 }));
        return;
      }
      const result = outcome(request);
      if (result.hang) return;
      if (result.error) {
        socket.write(frame({ type: 'error', kind: 'internal', message: 'spawn failed' }));
        return;
      }
      if (result.stdout) socket.write(frame({ type: 'stdout', data: b64(result.stdout) }));
      if (result.stderr) socket.write(frame({ type: 'stderr', data: b64(result.stderr) }));
      socket.write(frame({ type: 'exit', code: result.exit ?? 0 }));
    };
    socket.on('data', (chunk: Buffer) => {
      pending += chunk.toString('utf8');
      let newline = pending.indexOf('\n');
      while (newline >= 0) {
        onLine(pending.slice(0, newline));
        pending = pending.slice(newline + 1);
        newline = pending.indexOf('\n');
      }
    });
    socket.on('error', () => undefined);
  });
  await new Promise<void>((fulfill) => server.listen(0, '127.0.0.1', fulfill));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    calls,
    rpcs,
    close: () => {
      for (const relay of relays) relay.destroy();
      server.closeAllConnections();
      return new Promise((fulfill) => server.close(() => fulfill()));
    },
  };
}

describe('Cocoon Stack ComputeSDK provider', () => {
  let fake: Fake;

  beforeAll(async () => {
    fake = await fakeSandboxd();
  });

  afterAll(async () => {
    await fake.close();
  });

  beforeEach(() => {
    fake.calls.length = 0;
    fake.rpcs.length = 0;
  });

  const config = () => ({ baseUrl: fake.url, apiKey: 'node-token' });
  const execCommands = () =>
    fake.calls.filter((call) => call.path.endsWith('/exec')).map((call) => (call.body?.argv as string[])[2]);

  it('claims, runs node -v as one buffered exec, and releases with the claim token', async () => {
    const sdk = compute({ provider: cocoonstack(config()) });
    const sandbox = await sdk.sandbox.create();
    const result = await sandbox.runCommand('node -v');
    await sandbox.destroy();

    expect(result.stdout).toBe('v22.23.2\n');
    expect(result.exitCode).toBe(0);
    expect(fake.calls.map((call) => [call.method, call.path, call.auth])).toEqual([
      ['POST', '/v1/claim', 'Bearer node-token'],
      ['POST', '/v1/sandboxes/sb_1/exec', `Bearer ${TOKEN}`],
      ['POST', '/v1/sandboxes/sb_1/release', `Bearer ${TOKEN}`],
    ]);
    expect(fake.calls[0].body).toEqual({ template: 'node-rt:24.04', net: 'none', size: 'small', ttl_seconds: 300 });
    expect(fake.calls[1].body).toEqual({ argv: ['bash', '-c', 'node -v'] });
  });

  it('maps resource requests to the smallest covering size tier', async () => {
    const provider = cocoonstack(config());
    await provider.sandbox.create({ vcpus: 8, memoryMb: 16384 });
    await provider.sandbox.create({ size: 'medium' });
    await provider.sandbox.create({ cpus: 2 });
    await provider.sandbox.create({ memoryMiB: 6000 });
    await provider.sandbox.create({ cpu: 1, memory: 512 });

    expect(fake.calls.map((call) => call.body?.size)).toEqual(['2xlarge', 'medium', 'medium', 'xlarge', 'small']);
    await expect(provider.sandbox.create({ vcpus: 16 })).rejects.toThrow(/largest is 2xlarge/);
    await expect(provider.sandbox.create({ size: 'huge' })).rejects.toThrow(/Unknown Cocoon Stack size/);
  });

  it('turns the create timeout into the claim lease', async () => {
    const provider = cocoonstack(config());
    await provider.sandbox.create({ timeout: 600_000 });
    await provider.sandbox.create({ timeout: 1_500 });
    await provider.sandbox.create({ timeout: 10 * 86_400_000 });
    await cocoonstack({ ...config(), ttlSeconds: 900 }).sandbox.create();

    expect(fake.calls.map((call) => call.body?.ttl_seconds)).toEqual([600, 2, 86_400, 900]);
  });

  it('boots the template the caller names, else the configured default', async () => {
    await cocoonstack(config()).sandbox.create({ templateId: 'python-rt:3.12' });
    await cocoonstack(config()).sandbox.create({ image: 'base:24.04' });
    await cocoonstack({ ...config(), template: 'rt:24.04', net: 'egress', size: 'large' }).sandbox.create();

    expect(fake.calls.map((call) => [call.body?.template, call.body?.net, call.body?.size])).toEqual([
      ['python-rt:3.12', 'none', 'small'],
      ['base:24.04', 'none', 'small'],
      ['rt:24.04', 'egress', 'large'],
    ]);
  });

  it('answers getInfo from the claim without another request', async () => {
    const sandbox = await cocoonstack(config()).sandbox.create({ timeout: 600_000 });
    const info = await sandbox.getInfo();

    expect(fake.calls).toHaveLength(1);
    expect(info.id).toBe('sb_1');
    expect(info.provider).toBe('cocoonstack');
    expect(info.status).toBe('running');
    expect(info.createdAt).toBeInstanceOf(Date);
    expect(info.timeout).toBeGreaterThan(590_000);
    expect(info.metadata).toMatchObject({ template: 'node-rt:24.04', net: 'none', size: 'small' });
  });

  it('forwards cwd, env and the timeout to the exec endpoint', async () => {
    const sandbox = await cocoonstack(config()).sandbox.create();
    const result = await sandbox.runCommand('pwd', { cwd: '/work', env: { FOO: 'bar' }, timeout: 2_500 });

    expect(JSON.parse(result.stdout)).toEqual({ command: 'pwd', cwd: '/work', env: { FOO: 'bar' } });
    expect(fake.calls[1].body).toEqual({ argv: ['bash', '-c', 'pwd'], cwd: '/work', env: { FOO: 'bar' }, timeout_seconds: 3 });
  });

  it('reports a failing command through exitCode and stderr', async () => {
    const sandbox = await cocoonstack(config()).sandbox.create();
    const result = await sandbox.runCommand('exit 3');

    expect(result.exitCode).toBe(3);
    expect(result.stderr).toBe('boom\n');
  });

  it('streams output chunks over the relay in order', async () => {
    const seen: string[] = [];
    const sandbox = await cocoonstack(config()).sandbox.create();
    const result = await sandbox.runCommand('stream', {
      onStdout: (data) => seen.push(`out:${data}`),
      onStderr: (data) => seen.push(`err:${data}`),
    });

    expect(seen).toEqual(['out:one\n', 'err:warn\n', 'out:two\n']);
    expect(result.stdout).toBe('one\ntwo\n');
    expect(result.stderr).toBe('warn\n');
    expect(fake.rpcs[0].request).toEqual({ v: 1, op: 'exec', argv: ['bash', '-c', 'stream'] });
  });

  it('reassembles a multi-byte character split across relay frames', async () => {
    const sandbox = await cocoonstack(config()).sandbox.create();
    const result = await sandbox.runCommand('split', { onStdout: () => undefined });

    expect(result.stdout).toBe('é');
  });

  it('streams the bytes flushed at exit to the callbacks too', async () => {
    const sandbox = await cocoonstack(config()).sandbox.create();
    let streamedOut = '';
    let streamedErr = '';
    const result = await sandbox.runCommand('truncated', {
      onStdout: (text) => {
        streamedOut += text;
      },
      onStderr: (text) => {
        streamedErr += text;
      },
    });

    expect(streamedOut).toBe(result.stdout);
    expect(streamedErr).toBe(result.stderr);
    expect(result.stdout).toBe('\ufffd');
  });

  it('starts a background command detached and returns its pid', async () => {
    const sandbox = await cocoonstack(config()).sandbox.create();
    const result = await sandbox.runCommand('sleep 60', { background: true });

    expect(result).toMatchObject({ exitCode: 0, stdout: '42', stderr: '' });
    expect(fake.rpcs[0].request).toMatchObject({ detach: true });
  });

  it('times out a buffered command that never exits', async () => {
    const sandbox = await cocoonstack(config()).sandbox.create();

    await expect(sandbox.runCommand('hang', { timeout: 1_000 })).rejects.toThrow(/timed out after 1000 ms/);
  });

  it('times out a streamed command that never exits', async () => {
    const sandbox = await cocoonstack(config()).sandbox.create();

    await expect(sandbox.runCommand('hang', { timeout: 100, onStdout: () => undefined })).rejects.toThrow(
      /timed out after 100 ms/,
    );
  });

  it('surfaces a guest-side exec failure with its status', async () => {
    const sandbox = await cocoonstack(config()).sandbox.create();

    await expect(sandbox.runCommand('fail')).rejects.toSatisfy(
      (error: unknown) => error instanceof CocoonstackApiError && error.status === 502 && /spawn failed/.test(error.message),
    );
  });

  it('surfaces a silkd error frame on the relay', async () => {
    const sandbox = await cocoonstack(config()).sandbox.create();

    await expect(sandbox.runCommand('fail', { onStderr: () => undefined })).rejects.toThrow(/silkd internal: spawn failed/);
  });

  it('surfaces a refused exec with its status', async () => {
    const sandbox = await cocoonstack(config()).sandbox.create({ templateId: 'stale:24.04' });

    await expect(sandbox.runCommand('node -v')).rejects.toSatisfy(
      (error: unknown) => error instanceof CocoonstackApiError && error.status === 404,
    );
  });

  it('treats a release of an already-gone sandbox as done', async () => {
    const provider = cocoonstack(config());

    await expect(provider.sandbox.destroy('sb_gone')).resolves.toBeUndefined();
    expect(fake.calls[0].auth).toBe('Bearer node-token');
  });

  it('finds only the sandboxes this process claimed', async () => {
    const provider = cocoonstack(config());
    await provider.sandbox.create();
    const found = await provider.sandbox.getById('sb_1');
    const foreign = await provider.sandbox.getById('sb_9');
    const listed = await provider.sandbox.list();

    expect(found?.sandboxId).toBe('sb_1');
    expect(foreign).toBeNull();
    expect(listed.map((entry) => entry.sandboxId)).toEqual(['sb_1']);
    expect(fake.calls.filter((call) => call.path === '/v1/sandboxes')).toHaveLength(2);
  });

  it('forgets a claim once its lease has passed', async () => {
    const provider = cocoonstack(config());
    await provider.sandbox.create({ timeout: 1_000 });
    await new Promise((fulfill) => setTimeout(fulfill, 1_100));

    expect(await provider.sandbox.getById('sb_1')).toBeNull();
  });

  it('keeps the claim token when a release fails', async () => {
    const sandbox = await cocoonstack(config()).sandbox.create({ templateId: 'flaky:24.04' });

    await expect(sandbox.destroy()).rejects.toSatisfy((error: unknown) => error instanceof CocoonstackApiError && error.status === 503);
    await expect(sandbox.destroy()).resolves.toBeUndefined();
    expect(fake.calls.filter((call) => call.path === '/v1/sandboxes/sb_flaky/release').map((call) => call.auth)).toEqual([
      'Bearer tok_flaky',
      'Bearer tok_flaky',
    ]);
  });

  it('bounds a streamed command by the request timeout when none is given', async () => {
    const sandbox = await cocoonstack({ ...config(), requestTimeoutMs: 200 }).sandbox.create();

    await expect(sandbox.runCommand('hang', { onStdout: () => undefined })).rejects.toThrow(/timed out after 200 ms/);
  });

  it('refuses a response larger than 16 MiB', async () => {
    const sandbox = await cocoonstack(config()).sandbox.create();

    await expect(sandbox.runCommand('huge')).rejects.toThrow(/exceeds 16 MiB/);
    await expect(sandbox.runCommand('huge-utf8')).rejects.toThrow(/exceeds 16 MiB/);
  });

  it('opens no connection at construction unless preconnect is set', () => {
    h2.connects.length = 0;
    cocoonstack({ baseUrl: 'https://127.0.0.1:1', apiKey: 'x' });
    cocoonstack({ baseUrl: 'https://', apiKey: 'x', preconnect: true });
    expect(h2.connects).toEqual([]);

    cocoonstack({ baseUrl: 'https://127.0.0.1:1', apiKey: 'x', preconnect: true });
    cocoonstack({ baseUrl: 'HTTPS://127.0.0.1:2/', apiKey: 'x', preconnect: true });
    expect(h2.connects).toEqual(['https://127.0.0.1:1', 'https://127.0.0.1:2']);
  });

  it('refuses a claim the node redirected to a peer', async () => {
    await expect(cocoonstack(config()).sandbox.create({ templateId: 'elsewhere:24.04' })).rejects.toThrow(
      /redirected the claim to 10.0.0.6:7777/,
    );
  });

  it('keeps the node error in a failed claim', async () => {
    await expect(cocoonstack(config()).sandbox.create({ templateId: 'missing:24.04' })).rejects.toThrow(
      /failed \(404\): unknown template/,
    );
  });

  it('lists a directory, keeping a name that holds a newline', async () => {
    const sandbox = await cocoonstack(config()).sandbox.create();

    expect(await sandbox.filesystem.readdir('/list')).toEqual([
      { name: 'plain.txt', type: 'file', size: 6, modified: new Date(1757000000500) },
      { name: 'sub', type: 'directory', size: 4096, modified: new Date(1757000001000) },
      { name: 'odd\nname.txt', type: 'file', size: 0, modified: new Date(1757000002000) },
    ]);
  });

  it('replays the bytes flushed at exit in the order their streams arrived', async () => {
    const sandbox = await cocoonstack(config()).sandbox.create();
    const order: string[] = [];
    await sandbox.runCommand('truncated-err-first', {
      onStdout: () => order.push('stdout'),
      onStderr: () => order.push('stderr'),
    });

    expect(order).toEqual(['stderr', 'stdout']);
  });

  it('anchors a relative path so a leading dash or paren is not read as an option', async () => {
    const sandbox = await cocoonstack(config()).sandbox.create();
    await sandbox.filesystem.mkdir('-dash');
    await sandbox.filesystem.remove('(');
    await sandbox.filesystem.writeFile('bar.txt', 'x');
    await sandbox.filesystem.readFile('/tmp/abs.txt');

    expect(execCommands()).toEqual([
      'mkdir -p "./-dash"',
      'rm -rf "./("',
      'mkdir -p "./." && printf %s "eA==" | base64 -d > "./bar.txt"',
      'cat "/tmp/abs.txt"',
    ]);
  });

  it('mints a preview URL for a port', async () => {
    const sandbox = await cocoonstack(config()).sandbox.create();

    expect(await sandbox.getUrl({ port: 3000 })).toBe('http://preview.test/p/3000/');
    expect(fake.calls[1].body).toEqual({ token: TOKEN, port: 3000, ttl_seconds: 0 });
  });

  it('drives the filesystem verbs through the shell', async () => {
    const sandbox = await cocoonstack(config()).sandbox.create();
    await sandbox.filesystem.writeFile('/tmp/dir/a.txt', 'hello');
    await sandbox.filesystem.readFile('/tmp/dir/a.txt');
    await sandbox.filesystem.exists('/tmp/dir/a.txt');
    await sandbox.filesystem.remove('/tmp/dir');

    const commands = fake.rpcs.map((rpc) => (rpc.request.argv as string[])[2]);
    expect(commands[0]).toBe(`mkdir -p "/tmp/dir" && printf %s "${Buffer.from('hello').toString('base64')}" | base64 -d > "/tmp/dir/a.txt"`);
    expect(commands[1]).toBe('cat "/tmp/dir/a.txt"');
    expect(commands[2]).toBe('test -e "/tmp/dir/a.txt"');
    expect(commands[3]).toBe('rm -rf "/tmp/dir"');
  });

  it('names the missing endpoint', async () => {
    const previous = process.env.COCOONSTACK_API_URL;
    delete process.env.COCOONSTACK_API_URL;
    try {
      await expect(cocoonstack({}).sandbox.list()).rejects.toThrow(/COCOONSTACK_API_URL/);
    } finally {
      if (previous !== undefined) process.env.COCOONSTACK_API_URL = previous;
    }
  });
});

runProviderTestSuite({
  name: 'cocoonstack',
  provider: cocoonstack({ baseUrl: process.env.COCOONSTACK_API_URL ?? 'http://127.0.0.1:1' }),
  supportsFilesystem: true,
  skipIntegration: !process.env.COCOONSTACK_API_URL,
});
