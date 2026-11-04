import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Leap0Error, Leap0NotFoundError } from 'leap0';
import { leap0 } from '../index';

// Real ComputeSDK factory and installed native SDK; only HTTP is replaced.
const http = vi.fn();
const resource = (id: unknown = 'native-id', state = 'running') => ({
  id, template_id: 'template', state, vcpu: 1, memory: 512, disk: 1024,
  created_at: '2026-01-01T00:00:00Z',
});
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const sdk = () => leap0({ apiKey: 'local-test-key', baseUrl: 'https://control.invalid' });

beforeEach(() => {
  for (const key of ['LEAP0_API_KEY', 'LEAP0_BASE_URL', 'LEAP0_SANDBOX_DOMAIN', 'LEAP0_SDK_OTEL_ENABLED', 'OTEL_EXPORTER_OTLP_ENDPOINT', 'OTEL_EXPORTER_OTLP_HEADERS']) vi.stubEnv(key, '');
  http.mockReset();
  http.mockRejectedValue(new Error('Unexpected local HTTP request'));
  vi.stubGlobal('fetch', http);
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe('Leap0 lifecycle contract', () => {
  it('returns native canonical identity and caches its client for preview URLs', async () => {
    http.mockResolvedValueOnce(json(resource()));
    const box = await sdk().instances.getById('lookup-alias');
    expect(box?.instanceId).toBe('native-id');
    expect(box?.sandboxId).toBe('native-id');
    await expect(box!.getUrl({ port: 3000 })).resolves.toContain('native-id');
    // The real framework additionally attempts an optional egress pointer read.
    expect(http.mock.calls.filter(call => String(call[0]).endsWith('/v1/sandbox/lookup-alias/'))).toHaveLength(1);
  });
  it('does not turn retained deleted metadata into absence', async () => {
    http.mockResolvedValueOnce(json(resource('retained-id', 'deleted')));
    expect((await sdk().instances.getById('retained-id'))?.instanceId).toBe('retained-id');
  });
  it('returns null only for native resource-not-found', async () => {
    http.mockResolvedValueOnce(json({ message: 'missing' }, 404));
    await expect(sdk().instances.getById('missing-id')).resolves.toBeNull();
  });
  it.each([400, 401, 403, 410, 429, 500])('propagates get HTTP %s', async status => {
    http.mockResolvedValueOnce(json({ message: 'failure' }, status));
    await expect(sdk().instances.getById('failure-id')).rejects.toBeInstanceOf(Leap0Error);
  });
  it('propagates get transport failure', async () => {
    await expect(sdk().instances.getById('failure-id')).rejects.toBeInstanceOf(Leap0Error);
  });
  it('does not swallow local missing credentials', async () => {
    await expect(leap0({}).instances.getById('failure-id')).rejects.toThrow(/Missing Leap0 API key/);
    expect(http).not.toHaveBeenCalled();
  });
  it.each([undefined, null, '', '   ', 42])('rejects malformed lookup identity %s', async id => {
    http.mockResolvedValueOnce(json(resource(id)));
    // undefined defaults in resource(), so explicitly remove this required field.
    if (id === undefined) http.mockReset().mockResolvedValueOnce(json({ ...resource(), id: undefined }));
    await expect(sdk().instances.getById('bad-id')).rejects.toThrow();
  });
  it.each(['', '   '])('rejects empty create identity %s', async id => {
    http.mockResolvedValueOnce(json(resource(id)));
    await expect(sdk().instances.create()).rejects.toThrow();
  });
  it('accepts native void delete acknowledgement', async () => {
    http.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await expect(sdk().instances.destroy('delete-id')).resolves.toBeUndefined();
    expect(http.mock.calls[0][1].method).toBe('DELETE');
  });
  it('accepts typed missing delete without a preflight lookup', async () => {
    http.mockResolvedValueOnce(json({ message: 'missing' }, 404));
    await expect(sdk().instances.destroy('missing-id')).resolves.toBeUndefined();
    expect(http).toHaveBeenCalledTimes(1);
  });
  it.each([400, 401, 403, 410, 429, 500])('propagates delete HTTP %s', async status => {
    http.mockResolvedValueOnce(json({ message: 'failure' }, status));
    await expect(sdk().instances.destroy('failure-id')).rejects.toBeInstanceOf(Leap0Error);
  });
  it('propagates delete transport failure', async () => {
    await expect(sdk().instances.destroy('failure-id')).rejects.toBeInstanceOf(Leap0Error);
  });
  it('keeps the cached canonical client after failed delete', async () => {
    http.mockImplementation(async (url, init) => {
      const path = new URL(String(url)).pathname;
      if (path === '/v1/sandbox/cached-id/' && init?.method === 'GET') {
        return json(resource('cached-id'));
      }
      if (path === '/v1/sandbox/cached-id/' && init?.method === 'DELETE') {
        return json({ message: 'denied' }, 403);
      }
      // The real framework's optional egress pointer read is not deletion.
      return json({ message: 'missing optional metadata' }, 404);
    });
    const box = await sdk().instances.getById('cached-id');
    await expect(box!.destroy()).rejects.toMatchObject({ statusCode: 403 });
    const deletes = http.mock.calls.filter(call => call[1]?.method === 'DELETE');
    expect(deletes).toHaveLength(1);
    expect(new URL(String(deletes[0][0])).pathname).toBe('/v1/sandbox/cached-id/');
    await expect(box!.getUrl({ port: 3000 })).resolves.toContain('cached-id');
  });
  it('the installed native get maps scoped 404 to its actual class', async () => {
    http.mockResolvedValueOnce(json({ message: 'missing' }, 404));
    const { Leap0Client } = await import('leap0');
    await expect(new Leap0Client({ apiKey: 'local-test-key' }).sandboxes.get('missing-id')).rejects.toBeInstanceOf(Leap0NotFoundError);
  });
});

// Native lifecycle paths interpolate raw references. A routing-level 404 must
// never be misclassified as resource absence for a reference that changes route.
const unsafeReferences = [
  '/', 'a/b', '\\', 'a\\b', '?query=1', '#fragment', 'a?query=1', 'a#fragment',
  'a\r\nb', 'a\tb', '\0', '.', '..', '%2f', '%5C', '%3f', '%23', '%0d%0A', '%09', '%00',
  '%2e', '.%2e', '%2e.', '%2E%2e', '%252f', '%255c', '%253f', '%2523',
  '%250d%250a', '%252e%252e', '%25%32%66', '%2525252f', 'safe%2f..%2fother',
];
describe('leap0 route-safe lifecycle references', () => {
  for (const method of ['getById', 'destroy'] as const) {
    it.each(unsafeReferences)(`${method} rejects ambiguous reference %# before HTTP`, async reference => {
      http.mockResolvedValue(json({ message: 'routing miss', error: 'routing miss' }, 404));
      await expect(sdk().instances[method](reference)).rejects.toThrow();
      expect(http).not.toHaveBeenCalled();
    });
  }
  it.each(['canonical-id_123', 'my.box', '.hidden', 'a..b', 'name space', 'équipe-東京', 'name:@+$,;=', 'literal%25name', 'encoded%20space'])(
    'does not impose an undocumented alias grammar: %s', async reference => {
      http.mockResolvedValueOnce(json({ message: 'missing', error: 'missing' }, 404));
      await expect(sdk().instances.getById(reference)).resolves.toBeNull();
      expect(String(http.mock.calls[0][0])).toContain(new URL('https://control.invalid/v1/sandbox/' + reference + '/').pathname);
    },
  );
  it.each(['../other', '%2e%2e', 'unsafe?query=1', 'unsafe#fragment', '%252f'])(
    'rejects unsafe canonical native identity on lookup: %s', async id => {
      http.mockResolvedValueOnce(json(resource(id))).mockResolvedValueOnce(json({ message: 'routing miss', error: 'routing miss' }, 404));
      await expect(sdk().instances.getById('safe-lookup-reference')).rejects.toThrow();
      expect(http).toHaveBeenCalledTimes(1);
      expect(http.mock.calls.every(call => call[1]?.method !== 'DELETE')).toBe(true);
    },
  );
});
