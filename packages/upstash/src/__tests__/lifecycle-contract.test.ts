import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Box, BoxError } from '@upstash/box';
import { upstash, isUpstashBoxInstance } from '../index';

// Real factory + full Box API, not EphemeralBox or shared test-utils mocks.
const http = vi.fn();
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const resource = (id: unknown = 'canonical-box', status = 'running') => ({ id, status, created_at: 1, updated_at: 1 });
const sdk = () => upstash({ apiKey: 'local-test-key' });
beforeEach(() => {
  for (const key of ['UPSTASH_BOX_API_KEY', 'UPSTASH_BOX_BASE_URL', 'UPSTASH_DISABLE_TELEMETRY']) vi.stubEnv(key, '');
  http.mockReset();
  http.mockRejectedValue(new Error('Unexpected local HTTP request'));
  vi.stubGlobal('fetch', http);
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe('Upstash full Box lifecycle contract', () => {
  it('supports native name aliases while returning canonical identity and a full Box', async () => {
    http.mockResolvedValueOnce(json(resource()));
    const box = await sdk().instances.getById('named-box');
    expect(box?.instanceId).toBe('canonical-box');
    expect(box?.sandboxId).toBe('canonical-box');
    expect(box!.getInstance()).toBeInstanceOf(Box);
    expect(isUpstashBoxInstance(box!.getInstance())).toBe(true);
    // The real framework additionally attempts an optional egress pointer read.
    expect(http.mock.calls.filter(call => String(call[0]).endsWith('/v2/box/named-box'))).toHaveLength(1);
  });
  it('does not filter retained stopped metadata', async () => {
    http.mockResolvedValueOnce(json(resource('retained-box', 'stopped')));
    expect((await sdk().instances.getById('retained-box'))?.instanceId).toBe('retained-box');
  });
  it.each(['deleted', 'paused', 'error', 'running', 'unknown', ' deleted '])(
    'refreshes exact public status without converting retained %s metadata to absence', async status => {
      http.mockResolvedValueOnce(json(resource('retained-box', 'running')));
      const box = await sdk().instances.getById('retained-box');
      http.mockReset();
      http.mockResolvedValueOnce(json({ status }));
      const info = await box!.getInfo();
      expect(info.id).toBe('retained-box');
      expect(info.metadata).toMatchObject({ upstashBoxId: 'retained-box', upstashStatus: status });
      expect(http).toHaveBeenCalledTimes(1);
      expect(String(http.mock.calls[0][0])).toMatch(/\/v2\/box\/retained-box\/status$/);
      expect(http.mock.calls[0][1].method).toBe('GET');
    },
  );
  it.each([{}, { status: null }, { status: 404 }, { status: {} }, { status: '' }, { status: ' ' }, []])(
    'rejects malformed public status without exposing native payload %#', async body => {
      http.mockResolvedValueOnce(json(resource()));
      const box = await sdk().instances.getById('canonical-box');
      http.mockReset();
      http.mockResolvedValueOnce(json(body));
      await expect(box!.getInfo()).rejects.toThrow('Upstash box info returned an invalid status.');
      expect(http).toHaveBeenCalledTimes(1);
    },
  );
  it.each([401, 403, 404, 500])('preserves info failure, sanitizing HTTP %s body', async status => {
    http.mockResolvedValueOnce(json(resource()));
    const box = await sdk().instances.getById('canonical-box');
    http.mockReset();
    http.mockResolvedValueOnce(json({ error: 'private-provider-body' }, status));
    let error: unknown;
    try { await box!.getInfo(); } catch (caught) { error = caught; }
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe('Upstash box info lookup failed.');
    expect(error).not.toHaveProperty('cause');
    expect(http).toHaveBeenCalledTimes(1);
  });
  it('maps scoped native 404 lookup to null', async () => {
    http.mockResolvedValueOnce(json({ error: 'missing' }, 404));
    await expect(sdk().instances.getById('missing-box')).resolves.toBeNull();
  });
  it.each([400, 401, 403, 410, 429, 500])('propagates lookup HTTP %s', async status => {
    http.mockResolvedValueOnce(json({ error: 'failure' }, status));
    await expect(sdk().instances.getById('failure-box')).rejects.toBeInstanceOf(BoxError);
  });
  it('propagates original lookup transport error', async () => {
    const error = new TypeError('local transport failure');
    http.mockRejectedValueOnce(error);
    await expect(sdk().instances.getById('failure-box')).rejects.toBe(error);
  });
  it('does not swallow missing credentials', async () => {
    await expect(upstash({}).instances.getById('failure-box')).rejects.toBeInstanceOf(BoxError);
    await expect(upstash({}).instances.destroy('failure-box')).rejects.toBeInstanceOf(BoxError);
    expect(http).not.toHaveBeenCalled();
  });
  it.each([undefined, null, '', '  ', 42])('rejects malformed lookup identity %s', async id => {
    http.mockResolvedValueOnce(json({ ...resource(), id }));
    await expect(sdk().instances.getById('bad-box')).rejects.toThrow();
  });
  it.each(['', '  ', 42])('rejects malformed create identity %s', async id => {
    http.mockResolvedValueOnce(json(resource(id)));
    await expect(sdk().instances.create()).rejects.toThrow();
  });
  it('deletes using canonical native identity and accepts void acknowledgement', async () => {
    http.mockResolvedValueOnce(json(resource())).mockResolvedValueOnce(new Response(null, { status: 204 }));
    await expect(sdk().instances.destroy('named-box')).resolves.toBeUndefined();
    expect(http.mock.calls.map(call => String(call[0]))).toEqual([
      expect.stringContaining('/v2/box/named-box'), expect.stringContaining('/v2/box/canonical-box'),
    ]);
    expect(http.mock.calls[1][1].method).toBe('DELETE');
  });
  it('accepts missing initial lookup without trying delete', async () => {
    http.mockResolvedValueOnce(json({ error: 'missing' }, 404));
    await expect(sdk().instances.destroy('missing-box')).resolves.toBeUndefined();
    expect(http).toHaveBeenCalledTimes(1);
  });
  it.each([400, 401, 403, 410, 429, 500])('propagates destroy preflight HTTP %s', async status => {
    http.mockResolvedValueOnce(json({ error: 'failure' }, status));
    await expect(sdk().instances.destroy('failure-box')).rejects.toBeInstanceOf(BoxError);
    expect(http).toHaveBeenCalledTimes(1);
  });
  it.each([400, 401, 403, 404, 410, 429, 500])('propagates post-positive delete HTTP %s', async status => {
    http.mockResolvedValueOnce(json(resource())).mockResolvedValueOnce(json({ error: 'failure' }, status));
    await expect(sdk().instances.destroy('named-box')).rejects.toBeInstanceOf(BoxError);
  });
  it('propagates post-positive transport failure', async () => {
    http.mockResolvedValueOnce(json(resource()));
    await expect(sdk().instances.destroy('named-box')).rejects.toBeInstanceOf(BoxError);
  });
  it('does not DELETE malformed native identity', async () => {
    http.mockResolvedValueOnce(json(resource('')));
    await expect(sdk().instances.destroy('bad-box')).rejects.toThrow();
    expect(http).toHaveBeenCalledTimes(1);
  });
});

// Native lifecycle paths interpolate raw references. A routing-level 404 must
// never be misclassified as resource absence for a reference that changes route.
const unsafeReferences = [
  '/', 'a/b', '\\', 'a\\b', '?query=1', '#fragment', 'a?query=1', 'a#fragment',
  'trailing-space ',
  'a\r\nb', 'a\tb', '\0', '.', '..', '%2f', '%5C', '%3f', '%23', '%0d%0A', '%09', '%00',
  '%2e', '.%2e', '%2e.', '%2E%2e', '%252f', '%255c', '%253f', '%2523',
  '%250d%250a', '%252e%252e', '%25%32%66', '%2525252f', 'safe%2f..%2fother',
];
describe('upstash route-safe lifecycle references', () => {
  for (const method of ['getById', 'destroy'] as const) {
    it.each(unsafeReferences)(`${method} rejects ambiguous reference %# before HTTP`, async reference => {
      http.mockResolvedValue(json({ message: 'routing miss', error: 'routing miss' }, 404));
      await expect(sdk().instances[method](reference)).rejects.toThrow();
      expect(http).not.toHaveBeenCalled();
    });
  }
  it.each(['canonical-id_123', 'my.box', '.hidden', 'a..b', 'name space', 'équipe-東京', 'name:@+$,;=', 'literal%25name', 'encoded%20space', 'encoded%20', ' leading-space'])(
    'does not impose an undocumented alias grammar: %s', async reference => {
      http.mockResolvedValueOnce(json({ message: 'missing', error: 'missing' }, 404));
      await expect(sdk().instances.getById(reference)).resolves.toBeNull();
      expect(String(http.mock.calls[0][0])).toContain('/v2/box/' + reference);
    },
  );
  it.each(['../other', '%2e%2e', 'unsafe?query=1', 'unsafe#fragment', '%252f'])(
    'rejects unsafe canonical native identity before DELETE: %s', async id => {
      http.mockResolvedValueOnce(json(resource(id))).mockResolvedValueOnce(json({ message: 'routing miss', error: 'routing miss' }, 404));
      await expect(sdk().instances.destroy('safe-lookup-reference')).rejects.toThrow();
      expect(http).toHaveBeenCalledTimes(1);
      expect(http.mock.calls.every(call => call[1]?.method !== 'DELETE')).toBe(true);
    },
  );
});
