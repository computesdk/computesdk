import { afterEach, describe, expect, it, vi } from 'vitest';
import { compute } from 'computesdk';
import { mosaic } from '../index.js';
import type { MosaicTemplateOptions } from '../index.js';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

interface Call {
  url: string;
  method: string;
  body?: any;
}

/** Route a fake Mosaic gateway, recording what the provider asked it for. */
function gateway(routes: Record<string, (body: any, url: URL) => Response>): Call[] {
  const calls: Call[] = [];
  globalThis.fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = init?.method || 'GET';
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ url: String(input), method, body });
    const route = routes[`${method} ${url.pathname}`];
    if (!route) throw new Error(`Unexpected request: ${method} ${url.pathname}`);
    return route(body, url);
  }) as typeof fetch;
  return calls;
}

const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });

const config = { baseUrl: 'https://sandbox.example.test', apiKey: 'secret' };

describe('Mosaic ComputeSDK provider', () => {
  it('measures the public ComputeSDK create and runCommand path', async () => {
    const calls = gateway({
      'POST /v1/sandboxes': () => json({ id: 'sbx-1', state: 'running', tti_ms: 11 }),
      'POST /v1/sandboxes/sbx-1/exec': () =>
        json({ stdout: 'v20.11.0\n', stderr: '', exit_code: 0, tti_ms: 18 }),
      'DELETE /v1/sandboxes/sbx-1': () => new Response(null, { status: 204 }),
    });

    const sdk = compute({ provider: mosaic(config) });
    const sandbox = await sdk.sandbox.create({ templateId: 'node-20', memoryMb: 4096, vcpus: 2 });
    const result = await sandbox.runCommand('node -v');
    await sandbox.destroy();

    expect(result.stdout).toBe('v20.11.0\n');
    expect(result.exitCode).toBe(0);
    expect(calls.map((call) => [call.method, new URL(call.url).pathname])).toEqual([
      ['POST', '/v1/sandboxes'],
      ['POST', '/v1/sandboxes/sbx-1/exec'],
      ['DELETE', '/v1/sandboxes/sbx-1'],
    ]);
    expect(calls[0].body).toEqual({
      template: 'node-20',
      memory_mb: 4096,
      vcpu: 2,
      enable_ssh: false,
      network_enabled: true,
    });
  });

  it('maps ComputeSDK runtime and resource options', async () => {
    const calls = gateway({
      'POST /v1/sandboxes': () => json({ id: 'sbx-python', state: 'running', tti_ms: 1 }),
    });

    const provider = mosaic({ baseUrl: config.baseUrl });
    await provider.sandbox.create({ runtime: 'python', memoryMiB: 2048, cpus: 1 });

    expect(calls[0].body).toEqual({
      template: 'python-3.11',
      memory_mb: 2048,
      vcpu: 1,
      enable_ssh: false,
      network_enabled: true,
    });
  });

  it('gives a sandbox egress unless the caller turns it off', async () => {
    const calls = gateway({
      'POST /v1/sandboxes': () => json({ id: 'sbx-air', state: 'running', tti_ms: 1 }),
    });

    await mosaic({ ...config, networkEnabled: false }).sandbox.create();

    expect(calls[0].body.network_enabled).toBe(false);
  });

  it('boots an environment when the template is not a stock one', async () => {
    const calls = gateway({
      'POST /v1/sandboxes': () => json({ id: 'sbx-env', state: 'running', tti_ms: 1 }),
    });

    const provider = mosaic(config);
    await provider.sandbox.create({ templateId: 'my-toolchain' });
    await provider.sandbox.create({ image: 'python:3.12-slim' });
    await provider.sandbox.create({ snapshotId: 'snap-123' });

    expect(calls.map((call) => call.body.snapshot_id)).toEqual([
      'my-toolchain',
      'python:3.12-slim',
      'snap-123',
    ]);
    expect(calls.every((call) => call.body.template === undefined)).toBe(true);
  });

  it('labels a sandbox so an agent can find it again', async () => {
    const calls = gateway({
      'POST /v1/sandboxes': () => json({ id: 'sbx-labelled', state: 'running', tti_ms: 1 }),
    });

    await mosaic(config).sandbox.create({ metadata: { session_id: 'abc' } });

    expect(calls[0].body.metadata).toEqual({ session_id: 'abc' });
  });

  it('detaches a background command through the shell tier, not a durable process', async () => {
    const calls = gateway({
      'POST /v1/sandboxes': () => json({ id: 'sbx-bg', state: 'running', tti_ms: 1 }),
      'POST /v1/sandboxes/sbx-bg/exec': () =>
        json({ stdout: '@@computesdk-job ok 4242\n', stderr: '', exit_code: 0 }),
    });

    const sandbox = await mosaic(config).sandbox.create();
    const result = await sandbox.runCommand('npm run dev', { background: true, cwd: '/workspace/app' });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(calls.map((call) => `${call.method} ${new URL(call.url).pathname}`)).toEqual([
      'POST /v1/sandboxes',
      'POST /v1/sandboxes/sbx-bg/exec',
    ]);
    const encoded = /printf '%s' '([^']+)'/.exec(calls[1].body.cmd as string)?.[1] ?? '';
    const launch = Buffer.from(encoded, 'base64').toString('utf8');
    expect(launch).toContain('setsid');
    expect(launch).toContain('npm run dev');
    expect(launch).toContain('/workspace/app');
  });

  it('mints a preview URL for a port', async () => {
    const calls = gateway({
      'POST /v1/sandboxes': () => json({ id: 'sbx-web', state: 'running', tti_ms: 1 }),
      'POST /v1/sandboxes/sbx-web/previews': () =>
        json({ id: 'pv-1', sandbox_id: 'sbx-web', port: 3000, url: 'https://pv-1.preview.example', expires_at_ns: 1 }),
    });

    const sandbox = await mosaic(config).sandbox.create();

    expect(await sandbox.getUrl({ port: 3000 })).toBe('https://pv-1.preview.example');
    expect(calls[1].body).toEqual({ port: 3000, expires_in_seconds: 3600 });
  });

  it('refuses a non-https preview without minting one', async () => {
    const calls = gateway({
      'POST /v1/sandboxes': () => json({ id: 'sbx-http', state: 'running', tti_ms: 1 }),
    });

    const sandbox = await mosaic(config).sandbox.create();

    await expect(sandbox.getUrl({ port: 3000, protocol: 'http' })).rejects.toThrow(/served over https/);
    expect(calls).toHaveLength(1);
  });

  it('treats a configured default that is not stock as an environment', async () => {
    const calls = gateway({
      'POST /v1/sandboxes': () => json({ id: 'sbx-default-env', state: 'running', tti_ms: 1 }),
    });

    await mosaic({ ...config, template: 'my-toolchain' }).sandbox.create();

    expect(calls[0].body.snapshot_id).toBe('my-toolchain');
    expect(calls[0].body.template).toBeUndefined();
  });

  it('reads and writes workspace files over the files API', async () => {
    const written: string[] = [];
    const calls = gateway({
      'POST /v1/sandboxes': () => json({ id: 'sbx-fs', state: 'running', tti_ms: 1 }),
      'PUT /v1/sandboxes/sbx-fs/files/content': (body) => {
        written.push(Buffer.from(body.content_base64, 'base64').toString('utf8'));
        return json({ path: body.path, content_base64: body.content_base64, size: 5 });
      },
      'GET /v1/sandboxes/sbx-fs/files/content': (_body, url) =>
        json({
          path: url.searchParams.get('path'),
          content_base64: Buffer.from('hello').toString('base64'),
          size: 5,
        }),
      'GET /v1/sandboxes/sbx-fs/files': () =>
        json({
          path: '/workspace',
          entries: [
            { name: 'app', path: '/workspace/app', kind: 'directory', size: 0, modified_at_ns: 1_000_000 },
            { name: 'a.txt', path: '/workspace/a.txt', kind: 'file', size: 5, modified_at_ns: 2_000_000 },
          ],
        }),
      'POST /v1/sandboxes/sbx-fs/files/mkdir': () => new Response(null, { status: 204 }),
      'DELETE /v1/sandboxes/sbx-fs/files/content': () => new Response(null, { status: 204 }),
    });

    const sandbox = await mosaic(config).sandbox.create();
    await sandbox.filesystem.writeFile('/workspace/a.txt', 'hello');
    const content = await sandbox.filesystem.readFile('/workspace/a.txt');
    await sandbox.filesystem.mkdir('/workspace/app');
    const entries = await sandbox.filesystem.readdir('/workspace');
    await sandbox.filesystem.remove('/workspace/a.txt');

    expect(written).toEqual(['hello']);
    expect(content).toBe('hello');
    expect(entries).toEqual([
      { name: 'app', type: 'directory', size: 0, modified: new Date(1) },
      { name: 'a.txt', type: 'file', size: 5, modified: new Date(2) },
    ]);
    expect(calls.some((call) => call.method === 'DELETE')).toBe(true);
  });

  it('falls back to the shell for paths the files API cannot reach', async () => {
    const commands: string[] = [];
    gateway({
      'POST /v1/sandboxes': () => json({ id: 'sbx-tmp', state: 'running', tti_ms: 1 }),
      'POST /v1/sandboxes/sbx-tmp/exec': (body) => {
        commands.push(body.cmd);
        return json({ stdout: 'outside\n', stderr: '', exit_code: 0, tti_ms: 1 });
      },
    });

    const sandbox = await mosaic(config).sandbox.create();

    expect(await sandbox.filesystem.readFile('/tmp/note')).toBe('outside\n');
    expect(commands[0]).toBe('cat "/tmp/note"');
  });

  it('checkpoints a sandbox as a named snapshot', async () => {
    const calls = gateway({
      'POST /v1/sandboxes/sbx-1/snapshots': () =>
        json({
          id: 'snap-1',
          name: 'my-toolchain',
          source_sandbox_id: 'sbx-1',
          template: 'node-20',
          memory_mb: 4096,
          vcpu: 2,
          created_at_ns: 3_000_000,
          state: 'ready',
        }),
    });

    const snapshot = await mosaic(config).snapshot!.create('sbx-1', { name: 'my-toolchain' });

    expect(calls[0].body).toEqual({ name: 'my-toolchain' });
    expect(snapshot).toEqual({
      id: 'snap-1',
      provider: 'mosaic',
      createdAt: new Date(3),
      metadata: { name: 'my-toolchain', template: 'node-20', memoryMb: 4096, vcpu: 2 },
    });
  });

  it('builds a template from a container image and waits for it', async () => {
    let polls = 0;
    gateway({
      'POST /v1/environments': () => json({ id: 'op-1', kind: 'environment.build', status: 'pending' }, 202),
      'GET /v1/operations/op-1': () => {
        polls += 1;
        if (polls < 2) return json({ id: 'op-1', status: 'running' });
        return json({
          id: 'op-1',
          status: 'succeeded',
          environment: {
            id: 'snap-img',
            name: 'my-env',
            source_sandbox_id: 'sbx-builder',
            template: 'custom-image',
            memory_mb: 4096,
            vcpu: 2,
            created_at_ns: 4_000_000,
            state: 'ready',
            source_image: 'python:3.12-slim',
            source_image_digest: 'sha256:abc',
          },
        });
      },
    });

    const options: MosaicTemplateOptions = { name: 'my-env', image: 'python:3.12-slim' };
    const template = await mosaic(config).template!.create(options);

    expect(template.id).toBe('snap-img');
    expect(template.metadata.sourceImage).toBe('python:3.12-slim');
    expect(template.metadata.sourceImageDigest).toBe('sha256:abc');
  }, 30_000);

  it('says what a template needs when no image is given', async () => {
    await expect(mosaic(config).template!.create({ name: 'my-env' })).rejects.toThrow(/pass `image`/);
  });

  it('lists only image-built environments as templates', async () => {
    gateway({
      'GET /v1/snapshots': () =>
        json({
          snapshots: [
            {
              id: 'snap-plain',
              source_sandbox_id: 'sbx-1',
              template: 'node-20',
              memory_mb: 4096,
              vcpu: 2,
              created_at_ns: 1_000_000,
              state: 'ready',
            },
            {
              id: 'snap-img',
              source_sandbox_id: 'sbx-2',
              template: 'custom-image',
              memory_mb: 4096,
              vcpu: 2,
              created_at_ns: 2_000_000,
              state: 'ready',
              source_image: 'golang:1.23',
            },
          ],
        }),
    });

    const provider = mosaic(config);

    expect((await provider.template!.list()).map((entry) => entry.id)).toEqual(['snap-img']);
    expect((await provider.snapshot!.list()).map((entry) => entry.id)).toEqual(['snap-plain', 'snap-img']);
    expect((await provider.snapshot!.list({ sandboxId: 'sbx-2' })).map((entry) => entry.id)).toEqual(['snap-img']);
  });

  it('reports a missing sandbox as absent rather than as a failure', async () => {
    gateway({
      'GET /v1/sandboxes/gone': () => json({ error: 'not_found', message: 'no such sandbox' }, 404),
      'DELETE /v1/sandboxes/gone': () => json({ error: 'not_found', message: 'no such sandbox' }, 404),
    });

    const provider = mosaic(config);

    expect(await provider.sandbox.getById('gone')).toBeNull();
    await expect(provider.sandbox.destroy('gone')).resolves.toBeUndefined();
  });

  it('creates a burst of sandboxes without putting every request in flight at once', async () => {
    let inFlight = 0;
    let peak = 0;
    let answer = () => {};
    const answered = new Promise<void>((resolve) => {
      answer = resolve;
    });
    globalThis.fetch = vi.fn(async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await answered;
      inFlight -= 1;
      return json({ id: 'sbx-burst', state: 'running', tti_ms: 9 });
    }) as typeof fetch;

    const provider = mosaic({ ...config, maxConcurrentRequests: 4 });
    const burst = Promise.all(Array.from({ length: 20 }, () => provider.sandbox.create({})));
    // Let every create reach the queue before any of them is answered.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(peak).toBe(4);

    answer();
    await burst;
    expect(peak).toBe(4);
  });

  it('lets a queued request through when the ones ahead of it are long-running', async () => {
    let started = 0;
    globalThis.fetch = vi.fn(async () => {
      started += 1;
      // A command that runs for minutes never frees its slot on its own.
      await new Promise(() => {});
      return json({});
    }) as typeof fetch;

    const provider = mosaic({ ...config, maxConcurrentRequests: 1 });
    void provider.sandbox.create({}).catch(() => {});
    void provider.sandbox.create({}).catch(() => {});
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(started).toBe(1);

    await new Promise((resolve) => setTimeout(resolve, 1_200));
    expect(started).toBe(2);
  });

  it('spends the caller timeout on the request, not on the queue', async () => {
    let released = () => {};
    const holder = new Promise<void>((resolve) => {
      released = resolve;
    });
    let answered = 0;
    globalThis.fetch = vi.fn(async (_url, init?: RequestInit) => {
      if (answered === 0) {
        answered += 1;
        await holder;
      } else {
        answered += 1;
      }
      expect((init?.signal as AbortSignal | undefined)?.aborted).toBe(false);
      return json({ id: 'sbx-timeout', state: 'running', tti_ms: 4 });
    }) as typeof fetch;

    const provider = mosaic({ ...config, maxConcurrentRequests: 1 });
    const first = provider.sandbox.create({});
    // Queued behind a request that outlives the second caller's own deadline.
    const second = provider.sandbox.create({ timeout: 300 });

    await expect(second).resolves.toMatchObject({ sandboxId: 'sbx-timeout' });
    released();
    await first;
  });

  it('keeps the gateway remediation in the error it throws', async () => {
    gateway({
      'POST /v1/sandboxes': () =>
        json(
          {
            error: 'unsupported_shape',
            message: 'node-20 is served at 4096 MB / 2 vCPU',
            remediation: 'Ask for one of the published shapes',
          },
          400,
        ),
    });

    await expect(mosaic(config).sandbox.create({ memoryMb: 65_536 })).rejects.toThrow(
      /unsupported_shape: node-20 is served at 4096 MB \/ 2 vCPU: Ask for one of the published shapes/,
    );
  });
  it('reads a file larger than one files request in pinned 8 MiB ranges', async () => {
    const chunk = 8 * 1024 * 1024;
    const calls = gateway({
      'POST /v1/sandboxes': () => json({ id: 'sbx-big', state: 'running' }),
      'GET /v1/sandboxes/sbx-big/files/content': (_body, url) => {
        const offset = Number(url.searchParams.get('offset'));
        const size = offset === 0 ? chunk : 3;
        const content = Buffer.alloc(size, offset === 0 ? 'a' : 'b').toString('base64');
        return json({ path: 'big', content_base64: content, size, offset, total_size: chunk + 3, version: 'v1', eof: offset > 0 });
      },
    });

    const sandbox = await mosaic(config).sandbox.create();
    const text = await sandbox.filesystem.readFile('/workspace/big');

    expect(text.length).toBe(chunk + 3);
    expect(text.endsWith('bbb')).toBe(true);
    const reads = calls.filter((call) => call.method === 'GET').map((call) => new URL(call.url).searchParams);
    expect(reads.map((query) => [query.get('offset'), query.get('version')])).toEqual([
      ['0', null],
      [String(chunk), 'v1'],
    ]);
  });

  it('reads through a symlink the files API refuses to follow', async () => {
    const calls = gateway({
      'POST /v1/sandboxes': () => json({ id: 'sbx-link', state: 'running' }),
      'GET /v1/sandboxes/sbx-link/files/content': () =>
        json({ error: { code: 'invalid_path', message: 'path is a symlink' } }, 400),
      'POST /v1/sandboxes/sbx-link/exec': () => json({ stdout: 'payload', stderr: '', exit_code: 0 }),
    });

    const sandbox = await mosaic(config).sandbox.create();

    expect(await sandbox.filesystem.readFile('/workspace/link.txt')).toBe('payload');
    expect(calls.at(-1)?.body.cmd).toContain('cat "/workspace/link.txt"');
  });

  it('writes a file too big for one exec body through staged uploads', async () => {
    const calls = gateway({
      'POST /v1/sandboxes': () => json({ id: 'sbx-up', state: 'running' }),
      'PUT /v1/sandboxes/sbx-up/files/content': () => json({ path: 'part', size: 1 }),
      'POST /v1/sandboxes/sbx-up/exec': () => json({ stdout: '', stderr: '', exit_code: 0 }),
    });

    const sandbox = await mosaic(config).sandbox.create();
    await sandbox.filesystem.writeFile('/tmp/bench/big.txt', 'x'.repeat(100 * 1024));

    const execs = calls.filter((call) => call.method === 'POST' && call.url.endsWith('/exec'));
    expect(calls.filter((call) => call.method === 'PUT')).toHaveLength(1);
    expect(execs.every((call) => JSON.stringify(call.body).length < 1024)).toBe(true);
    expect(execs[0].body.cmd).toMatch(/cat "\/workspace\/\.computesdk-upload-[^"]+"\/\* > "\/tmp\/bench\/big\.txt"/);
    expect(execs[1].body.cmd).toMatch(/^rm -rf "\/workspace\/\.computesdk-upload-/);
  });

  it('pauses and resumes the same sandbox through its native handle', async () => {
    const calls = gateway({
      'POST /v1/sandboxes': () => json({ id: 'sbx-nap', state: 'running' }),
      'POST /v1/sandboxes/sbx-nap/pause': () => json({ id: 'sbx-nap', state: 'paused' }),
      'POST /v1/sandboxes/sbx-nap/resume': () => json({ id: 'sbx-nap', state: 'running' }),
    });

    const sandbox = await mosaic(config).sandbox.create();
    const native = sandbox.getInstance();
    await native.pause({ killProcesses: true });
    expect(native.state).toBe('paused');
    await native.resume();

    expect(native.state).toBe('running');
    expect(calls.slice(1).map((call) => [new URL(call.url).pathname, call.body])).toEqual([
      ['/v1/sandboxes/sbx-nap/pause', { kill_processes: true }],
      ['/v1/sandboxes/sbx-nap/resume', {}],
    ]);
  });

  it('pauses and resumes through the ComputeSDK instance and declares what survives', async () => {
    const calls = gateway({
      'POST /v1/sandboxes': () => json({ id: 'sbx-life', state: 'running' }),
      'POST /v1/sandboxes/sbx-life/pause': () => json({ id: 'sbx-life', state: 'paused' }),
      'POST /v1/sandboxes/sbx-life/resume': () => json({ id: 'sbx-life', state: 'running' }),
    });

    const provider = mosaic(config);
    const sandbox = await provider.sandbox.create();
    await sandbox.pause!();
    expect(sandbox.getInstance().state).toBe('paused');
    await sandbox.resume!();

    expect(sandbox.getInstance().state).toBe('running');
    expect(calls.slice(1).map((call) => [new URL(call.url).pathname, call.body])).toEqual([
      ['/v1/sandboxes/sbx-life/pause', {}],
      ['/v1/sandboxes/sbx-life/resume', {}],
    ]);
    expect(provider.sandbox.pause).toEqual({ memory: true });
    expect(provider.snapshot!.capabilities).toEqual({ scope: 'rootfs', memory: true, destroysSource: false });
  });
});
