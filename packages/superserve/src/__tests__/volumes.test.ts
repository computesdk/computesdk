import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Volume as NativeVolume } from '@superserve/sdk';
import { superserve } from '../index';

const volumeId = '00000000-0000-4000-8000-000000000001';
const sandboxId = '00000000-0000-4000-8000-000000000002';
const attachmentId = '00000000-0000-4000-8000-000000000003';
const createdAt = '2026-01-01T00:00:00Z';
const baseUrl = 'https://api.example.test';
const apiKey = 'test-key';

const volume = {
  id: volumeId, name: 'test-volume', capacity_bytes: 1 << 30, used_bytes: 0,
  region: 'test-region', status: 'ready', generation: 1, created_at: createdAt, updated_at: createdAt,
};
const sandbox = {
  id: sandboxId, name: 'test-sandbox', status: 'active', access_token: 'test-access-token',
  vcpu_count: 2, memory_mib: 4096, timeout_seconds: 300, created_at: createdAt,
};

function attachment(overrides: Record<string, unknown> = {}) {
  return {
    id: attachmentId, volume_id: volumeId, sandbox_id: sandboxId, mount_path: '/data',
    read_only: false, status: 'mounted', generation: 1, lease_expires_at: createdAt,
    created_at: createdAt, updated_at: createdAt, ...overrides,
  };
}

const calls: Array<{ url: string; method: string; apiKey: string | null; body: any }> = [];
let responses: Response[] = [];

function respond(body: unknown, status = 200) {
  responses.push(new Response(status === 204 ? null : JSON.stringify(body), {
    status, headers: { 'Content-Type': 'application/json' },
  }));
}

beforeEach(() => {
  calls.length = 0;
  responses = [];
  vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, options: RequestInit = {}) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    calls.push({
      url, method: options.method || 'GET', apiKey: new Headers(options.headers).get('X-API-Key'),
      body: options.body ? JSON.parse(String(options.body)) : undefined,
    });
    const response = responses.shift();
    if (!response) throw new Error('Unexpected test request');
    return response;
  }));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('Superserve volumes through the published native SDK', () => {
  it('creates, resolves, lists and deletes volumes without exposing the native connection', async () => {
    const provider = superserve({ apiKey, baseUrl });
    respond(volume, 201);
    const created = await provider.volume!.create({
      name: 'test-volume', sizeBytes: 1 << 30, idempotencyKey: 'test-create-key',
      apiKey: 'untrusted-key', baseUrl: 'https://other.example.test',
    });
    expect(created).toMatchObject({ id: volumeId, name: 'test-volume', sizeBytes: 1 << 30 });
    expect(created).not.toHaveProperty('native');
    expect(JSON.stringify(created)).not.toContain(apiKey);
    expect(calls[0]).toMatchObject({
      url: baseUrl + '/volumes', method: 'POST', apiKey,
      body: { name: 'test-volume', capacity_bytes: 1 << 30, idempotency_key: 'test-create-key' },
    });

    respond(volume);
    expect(await provider.volume!.get('volume name')).toMatchObject({ id: volumeId });
    expect(calls[1].url).toBe(baseUrl + '/volumes/volume%20name');

    respond([volume]);
    expect(await provider.volume!.list({ limit: 2 })).toHaveLength(1);
    expect(calls[2].url).toBe(baseUrl + '/volumes?limit=2');

    respond(volume);
    respond(null, 204);
    await provider.volume!.delete(volumeId);
    expect(calls[4]).toMatchObject({ url: baseUrl + '/volumes/' + volumeId, method: 'DELETE', apiKey });
  });

  it('returns null only for missing volumes and propagates authorization and deletion failures', async () => {
    const provider = superserve({ apiKey, baseUrl });
    respond({ error: { code: 'volume_not_found', message: 'Volume not found' } }, 404);
    expect(await provider.volume!.get('missing')).toBeNull();
    respond({ error: { code: 'forbidden', message: 'Access denied' } }, 403);
    await expect(provider.volume!.get('forbidden')).rejects.toThrow('Access denied');
    respond({ error: { code: 'forbidden', message: 'Access denied' } }, 403);
    await expect(provider.volume!.list()).rejects.toThrow('Access denied');
    respond(volume);
    respond({ error: { code: 'volume_attached', message: 'Volume is attached' } }, 409);
    await expect(provider.volume!.delete(volumeId)).rejects.toThrow('Volume is attached');
    respond({ error: { code: 'volume_not_found' } }, 404);
    await expect(provider.volume!.delete('missing')).resolves.toBeUndefined();
  });

  it('waits only for closing leases after a volume-delete conflict', async () => {
    vi.useFakeTimers();
    const provider = superserve({ apiKey, baseUrl });
    respond(volume);
    respond({ error: { code: 'volume_conflict', message: 'Volume operation conflicts with the current resource state.' } }, 409);
    respond([attachment({ status: 'revoking' })]);
    respond(null, 204);
    const deleted = expect(provider.volume!.delete(volumeId)).resolves.toBeUndefined();
    await vi.advanceTimersByTimeAsync(3_000);
    await deleted;
    expect(calls.filter((call) => call.method === 'DELETE')).toHaveLength(2);
  });

  it('pins deletion to the original UUID when its name is reused between retries', async () => {
    vi.useFakeTimers();
    const replacementId = '00000000-0000-4000-8000-000000000004';
    let nameReused = false;
    let firstDelete = true;
    let replacementDeleted = false;
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, options: RequestInit = {}) => {
      const url = String(input);
      const method = options.method || 'GET';
      calls.push({ url, method, apiKey: new Headers(options.headers).get('X-API-Key'), body: undefined });
      if (method === 'GET' && url === baseUrl + '/volumes/test-volume') {
        return new Response(JSON.stringify(nameReused ? { ...volume, id: replacementId } : volume));
      }
      if (method === 'DELETE' && firstDelete) {
        firstDelete = false;
        return new Response(JSON.stringify({ error: { code: 'volume_conflict' } }), { status: 409 });
      }
      if (method === 'GET' && url === baseUrl + '/volumes/' + volumeId + '/attachments') {
        const closing = new Response(JSON.stringify([attachment({ status: 'revoking' })]));
        nameReused = true; // Another caller deletes the original and creates the same name.
        return closing;
      }
      if (method === 'DELETE' && url === baseUrl + '/volumes/' + volumeId) {
        return new Response(JSON.stringify({ error: { code: 'volume_not_found' } }), { status: 404 });
      }
      if (method === 'DELETE' && (url.endsWith('/test-volume') || url.endsWith('/' + replacementId))) {
        replacementDeleted = true;
        return new Response(null, { status: 204 });
      }
      throw new Error('Unexpected test request');
    }));
    const deleted = expect(superserve({ apiKey, baseUrl }).volume!.delete('test-volume')).resolves.toBeUndefined();
    await vi.advanceTimersByTimeAsync(3_000);
    await deleted;
    expect(nameReused).toBe(true);
    expect(replacementDeleted).toBe(false);
    expect(calls.filter((call) => call.method === 'DELETE').map((call) => call.url)).toEqual([
      baseUrl + '/volumes/' + volumeId,
      baseUrl + '/volumes/' + volumeId,
    ]);
    expect(calls.filter((call) => call.method === 'GET' && call.url.endsWith('/test-volume'))).toHaveLength(1);
    expect(calls.every((call) => call.apiKey === apiKey)).toBe(true);
  });

  it('does not retry a volume-delete conflict while an active mount remains', async () => {
    const provider = superserve({ apiKey, baseUrl });
    respond(volume);
    respond({ error: { code: 'volume_conflict', message: 'Volume operation conflicts with the current resource state.' } }, 409);
    respond([attachment()]);
    await expect(provider.volume!.delete(volumeId)).rejects.toThrow('conflicts');
    expect(calls.filter((call) => call.method === 'DELETE')).toHaveLength(1);
  });

  it('fails when closing leases do not settle within the bounded cleanup window', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, options: RequestInit = {}) => {
      const url = String(input);
      if (options.method === 'DELETE') {
        return new Response(JSON.stringify({ error: { code: 'volume_conflict', message: 'Volume remains in conflict' } }), { status: 409 });
      }
      return new Response(JSON.stringify(url.endsWith('/attachments')
        ? [attachment({ status: 'revoking' })] : volume));
    }));
    const result = superserve({ apiKey, baseUrl }).volume!.delete(volumeId).catch((error) => error);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(await result).toMatchObject({ code: 'volume_conflict' });
  });

  it('waits for batched deletion to finish and observes only the original UUID', async () => {
    vi.useFakeTimers();
    let observations = 0;
    let settled = false;
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, options: RequestInit = {}) => {
      const url = String(input);
      const method = options.method || 'GET';
      calls.push({ url, method, apiKey: new Headers(options.headers).get('X-API-Key'), body: undefined });
      if (method === 'DELETE') {
        return new Response(JSON.stringify({ error: { code: 'volume_unavailable' } }), { status: 503 });
      }
      if (url === baseUrl + '/volumes/test-volume') return new Response(JSON.stringify(volume));
      expect(url).toBe(baseUrl + '/volumes/' + volumeId);
      observations++;
      return observations === 1
        ? new Response(JSON.stringify({ ...volume, status: 'deleting' }))
        : new Response(JSON.stringify({ error: { code: 'volume_not_found' } }), { status: 404 });
    }));
    const result = superserve({ apiKey, baseUrl }).volume!.delete('test-volume').then(() => { settled = true; });
    await vi.advanceTimersByTimeAsync(2_500);
    expect(observations).toBe(1);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(10_000);
    await result;
    expect(observations).toBe(2);
    expect(calls.filter((call) => call.method === 'DELETE').every((call) => call.url === baseUrl + '/volumes/' + volumeId)).toBe(true);
    expect(calls.filter((call) => call.url.endsWith('/test-volume'))).toHaveLength(1);
  });

  it.each(['ready', 'error'])('does not treat a %s volume as deletion progress after a 503', async (status) => {
    vi.useFakeTimers();
    respond(volume);
    for (let attempt = 0; attempt < 3; attempt++) respond({ error: { code: 'volume_unavailable' } }, 503);
    respond({ ...volume, status });
    const result = superserve({ apiKey, baseUrl }).volume!.delete(volumeId).catch((error) => error);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(await result).toMatchObject({ statusCode: 503, code: 'volume_unavailable' });
    expect(calls.filter((call) => call.method === 'DELETE')).toHaveLength(3);
    expect(calls.filter((call) => call.method === 'GET')).toHaveLength(2);
  });

  it('does not inspect or retry an unrelated server failure as deletion progress', async () => {
    vi.useFakeTimers();
    respond(volume);
    for (let attempt = 0; attempt < 3; attempt++) respond({ error: { code: 'backend_error' } }, 503);
    const result = superserve({ apiKey, baseUrl }).volume!.delete(volumeId).catch((error) => error);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(await result).toMatchObject({ code: 'backend_error' });
    expect(calls.filter((call) => call.method === 'GET')).toHaveLength(1);
  });

  it.each(['delete', 'deletion-state', 'attachment-state'])(
    'passes the remaining budget to a slow native %s request',
    async (slowRequest) => {
      vi.useFakeTimers();
      let initial = true;
      let observed = false;
      let settled = false;
      vi.stubGlobal('fetch', vi.fn((input: string | URL | Request, options: RequestInit = {}) => {
        if (initial) {
          initial = false;
          return Promise.resolve(new Response(JSON.stringify(volume)));
        }
        if (options.method === 'DELETE' && slowRequest !== 'delete') {
          return Promise.resolve(observed
            ? new Response(null, { status: 204 })
            : new Response(JSON.stringify({ error: { code: slowRequest === 'deletion-state' ? 'volume_unavailable' : 'volume_conflict' } }),
              { status: slowRequest === 'deletion-state' ? 503 : 409 }));
        }
        observed = true;
        const signal = options.signal!;
        return new Promise<Response>((resolve, reject) => {
          const timer = setTimeout(() => {
            signal.removeEventListener('abort', abort);
            resolve(options.method === 'DELETE'
              ? new Response(null, { status: 204 })
              : new Response(JSON.stringify(slowRequest === 'deletion-state'
                ? { ...volume, status: 'deleting' }
                : [attachment({ status: 'revoking' })])));
          }, 40_000);
          const abort = () => {
            clearTimeout(timer);
            signal.removeEventListener('abort', abort);
            reject(signal.reason);
          };
          signal.addEventListener('abort', abort, { once: true });
          if (signal.aborted) abort();
        });
      }));
      const result = superserve({ apiKey, baseUrl }).volume!.delete(volumeId).then(
        () => { settled = true; },
        (error) => { settled = true; return error; },
      );
      await vi.advanceTimersByTimeAsync(30_000);
      expect(settled).toBe(false);
      await vi.advanceTimersByTimeAsync(30_000);
      expect(await result).toBeUndefined();
    },
  );

  it('aborts in-flight native retries at the aggregate deletion deadline', async () => {
    vi.useFakeTimers();
    const started = Date.now();
    const startedCalls: number[] = [];
    const signals: AbortSignal[] = [];
    let initial = true;
    vi.stubGlobal('fetch', vi.fn((input: string | URL | Request, options: RequestInit = {}) => {
      if (initial) {
        initial = false;
        return Promise.resolve(new Response(JSON.stringify(volume)));
      }
      startedCalls.push(Date.now());
      const signal = options.signal!;
      signals.push(signal);
      return new Promise<Response>((resolve, reject) => {
        const finish = () => {
          signal.removeEventListener('abort', abort);
          resolve(options.method === 'DELETE'
            ? new Response(JSON.stringify({ error: { code: 'volume_unavailable' } }), { status: 503 })
            : new Response(JSON.stringify({ ...volume, status: 'deleting' })));
        };
        const timer = setTimeout(finish, 20_000);
        const abort = () => {
          clearTimeout(timer);
          signal.removeEventListener('abort', abort);
          reject(signal.reason);
        };
        signal.addEventListener('abort', abort, { once: true });
        if (signal.aborted) abort();
      });
    }));
    const result = superserve({ apiKey, baseUrl }).volume!.delete(volumeId).catch((error) => error);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(await result).toMatchObject({ code: 'volume_unavailable' });
    expect(signals.at(-1)?.aborted).toBe(true);
    expect(startedCalls.every((time) => time < started + 120_000)).toBe(true);
    const requestCount = startedCalls.length;
    await vi.advanceTimersByTimeAsync(120_000);
    expect(startedCalls).toHaveLength(requestCount);
  });

  it('passes unified handles and read-only mounts through native create-time attachment', async () => {
    const provider = superserve({ apiKey, baseUrl });
    respond(sandbox, 201);
    respond(volume);
    respond(attachment({ read_only: true }), 201);

    const created = await provider.sandbox.create({
      name: 'with-volume', timeout: 120_001,
      volumes: [{ volume: { id: volumeId, name: 'test-volume' }, mountPath: '/data', readOnly: true }],
    });

    expect(created.sandboxId).toBe(sandboxId);
    expect(calls[0].body).toMatchObject({ name: 'with-volume', timeout_seconds: 121 });
    expect(calls[2]).toMatchObject({
      url: baseUrl + '/sandboxes/' + sandboxId + '/volumes', method: 'POST',
      body: { volume_id: volumeId, mount_path: '/data', read_only: true },
    });
  });

  it('keeps runtime attachments on the sandbox connection after environment changes', async () => {
    vi.stubEnv('SUPERSERVE_API_KEY', apiKey);
    vi.stubEnv('SUPERSERVE_BASE_URL', baseUrl);
    respond(sandbox, 201);
    const created = await superserve({}).sandbox.create();
    vi.stubEnv('SUPERSERVE_API_KEY', 'other-key');
    vi.stubEnv('SUPERSERVE_BASE_URL', 'https://other.example.test');
    respond(volume);
    respond(attachment(), 201);

    await created.attachVolume!(volumeId, '/data');
    expect(calls.slice(1).every((call) => call.apiKey === apiKey && call.url.startsWith(baseUrl))).toBe(true);
  });

  it('detaches only the requested live attachment on this sandbox', async () => {
    const provider = superserve({ apiKey, baseUrl });
    respond(sandbox, 201);
    const created = await provider.sandbox.create();
    respond(volume);
    respond([
      attachment({ sandbox_id: 'sb-test-' + sandboxId.toUpperCase() }),
      attachment({ id: 'other-sandbox', sandbox_id: 'other-sandbox' }),
      attachment({ id: 'other-path', mount_path: '/other' }),
      attachment({ id: 'already-revoked', status: 'revoked' }),
    ]);
    respond(attachment());
    respond(null, 204);

    await created.detachVolume!({ id: volumeId }, '/data');
    expect(calls.filter((call) => call.method === 'DELETE').map((call) => call.url)).toEqual([
      baseUrl + '/volume-attachments/' + attachmentId,
    ]);
  });

  it('refuses an ambiguous detach without touching either mount', async () => {
    const provider = superserve({ apiKey, baseUrl });
    respond(sandbox, 201);
    const created = await provider.sandbox.create();
    respond(volume);
    respond([attachment(), attachment({ id: 'second-mount', mount_path: '/other' })]);
    await expect(created.detachVolume!(volumeId)).rejects.toThrow('Multiple matching');
    expect(calls.filter((call) => call.method === 'DELETE')).toEqual([]);
  });

  it('finds existing attachments after reconnecting without a local attachment cache', async () => {
    const provider = superserve({ apiKey, baseUrl });
    respond(sandbox);
    const connected = await provider.sandbox.getById(sandboxId);
    expect(connected).not.toBeNull();
    respond(volume);
    respond([attachment()]);
    respond(attachment());
    respond(null, 204);
    await connected!.detachVolume!(volumeId, '/data');
    expect(calls.filter((call) => call.method === 'DELETE').map((call) => call.url)).toEqual([
      baseUrl + '/volume-attachments/' + attachmentId,
    ]);
  });

  it('treats an already-revoked attachment as detached', async () => {
    const provider = superserve({ apiKey, baseUrl });
    respond(sandbox, 201);
    const created = await provider.sandbox.create();
    respond(volume);
    respond([attachment({ status: 'revoked' })]);
    await expect(created.detachVolume!(volumeId, '/data')).resolves.toBeUndefined();
    expect(calls.filter((call) => call.method === 'DELETE')).toEqual([]);
  });

  it('preserves native handle connection checks before creating a sandbox', async () => {
    respond(volume, 201);
    const native = await NativeVolume.create({ apiKey: 'other-key', baseUrl, name: 'test-volume' });
    const provider = superserve({ apiKey, baseUrl });
    await expect(provider.sandbox.create({
      volumes: [{ volume: native, mountPath: '/data' }],
    })).rejects.toThrow('same API connection');
    expect(calls.filter((call) => call.url.endsWith('/sandboxes'))).toEqual([]);
  });
});
