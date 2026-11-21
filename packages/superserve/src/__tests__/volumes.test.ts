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

    respond(null, 204);
    await provider.volume!.delete(volumeId);
    expect(calls[3]).toMatchObject({ url: baseUrl + '/volumes/' + volumeId, method: 'DELETE', apiKey });
  });

  it('returns null only for missing volumes and propagates authorization and deletion failures', async () => {
    const provider = superserve({ apiKey, baseUrl });
    respond({ error: { code: 'volume_not_found', message: 'Volume not found' } }, 404);
    expect(await provider.volume!.get('missing')).toBeNull();
    respond({ error: { code: 'forbidden', message: 'Access denied' } }, 403);
    await expect(provider.volume!.get('forbidden')).rejects.toThrow('Access denied');
    respond({ error: { code: 'forbidden', message: 'Access denied' } }, 403);
    await expect(provider.volume!.list()).rejects.toThrow('Access denied');
    respond({ error: { code: 'volume_attached', message: 'Volume is attached' } }, 409);
    await expect(provider.volume!.delete(volumeId)).rejects.toThrow('Volume is attached');
    respond({ error: { code: 'volume_not_found' } }, 404);
    await expect(provider.volume!.delete('missing')).resolves.toBeUndefined();
  });

  it('waits only for closing leases after a volume-delete conflict', async () => {
    vi.useFakeTimers();
    const provider = superserve({ apiKey, baseUrl });
    respond({ error: { code: 'volume_conflict', message: 'Volume operation conflicts with the current resource state.' } }, 409);
    respond(volume);
    respond([attachment({ status: 'revoking' })]);
    respond(null, 204);
    const deleted = expect(provider.volume!.delete(volumeId)).resolves.toBeUndefined();
    await vi.advanceTimersByTimeAsync(3_000);
    await deleted;
    expect(calls.filter((call) => call.method === 'DELETE')).toHaveLength(2);
  });

  it('does not retry a volume-delete conflict while an active mount remains', async () => {
    const provider = superserve({ apiKey, baseUrl });
    respond({ error: { code: 'volume_conflict', message: 'Volume operation conflicts with the current resource state.' } }, 409);
    respond(volume);
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
