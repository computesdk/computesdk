import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { agentuity } from '../index';

// Only the in-package HTTP client boundary is replaced; the provider factory is real.
const http = vi.fn();
const config = { apiKey: 'test-key', baseURL: 'https://agentuity.invalid' };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { 'content-type': 'application/json' },
});
const provider = () => agentuity(config);
beforeEach(() => { http.mockReset(); vi.stubGlobal('fetch', http); vi.stubEnv('AGENTUITY_SDK_KEY', ''); });
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe('Agentuity lifecycle contract', () => {
  it.each(['sb-one ', ' sb-one', '. ', '.. ', '.', '..', 'sb-one\u00a0', ...Array.from({ length: 32 }, (_, i) => `sb${String.fromCharCode(i)}one`), 'sb\u007fone'])('rejects untrimmed/control/dot identity %j for create and before resource HTTP', async (id) => {
    http.mockResolvedValue(json({ success: true, data: { sandboxId: id } }));
    await expect(provider().instances.create()).rejects.toThrow(/identity/i);
    expect(http).toHaveBeenCalledOnce();
    http.mockClear();
    await expect(provider().instances.getById(id)).rejects.toThrow(/identity/i);
    await expect(provider().instances.destroy(id)).rejects.toThrow(/identity/i);
    expect(http).not.toHaveBeenCalled();
  });
  it('keeps percent-encoded text literal instead of interpreting it as traversal', async () => {
    const id = 'literal%2e%2e';
    http.mockImplementation(async (url: string) => {
      if (url === config.baseURL + '/sandbox/literal%252e%252e') return json({ success: true, data: { sandboxId: id } });
      throw new Error('no egress file');
    });
    expect((await provider().instances.getById(id))?.instanceId).toBe(id);
    expect(http.mock.calls[0][0]).toBe(config.baseURL + '/sandbox/literal%252e%252e');
  });
  it.each(['', '.', '..'])('rejects a non-resource reference %j before HTTP', async (id) => {
    await expect(provider().instances.getById(id)).rejects.toThrow(/identity/i);
    await expect(provider().instances.destroy(id)).rejects.toThrow(/identity/i);
    expect(http).not.toHaveBeenCalled();
  });
  it.each(['getById', 'destroy'] as const)('%s requires credentials instead of claiming absence/success', async (method) => {
    const call = agentuity({ baseURL: config.baseURL }).instances[method]('sb-one');
    await expect(call).rejects.toThrow(/Missing Agentuity API key/);
    expect(http).not.toHaveBeenCalled();
  });
  it('looks up the documented resource route and validates the returned identity', async () => {
    http.mockImplementation(async (url: string) => {
      if (url === config.baseURL + '/sandbox/sb-one') return json({ success: true, data: { sandboxId: 'sb-one' } });
      throw new Error('unexpected hydration route');
    });
    const result = await provider().instances.getById('sb-one');
    expect(result?.instanceId).toBe('sb-one');
    expect(http.mock.calls[0][0]).toBe(config.baseURL + '/sandbox/sb-one');
  });
  it('encodes the resource ID as a single path segment', async () => {
    http.mockResolvedValue(json({}, 404));
    expect(await provider().instances.getById('sb/one')).toBeNull();
    expect(http.mock.calls[0][0]).toBe(config.baseURL + '/sandbox/sb%2Fone');
  });
  it.each([401, 403, 429, 500])('lookup HTTP %s is not absence', async (status) => {
    http.mockResolvedValue(json({ error: 'private body' }, status));
    await expect(provider().instances.getById('sb-one')).rejects.toThrow(String(status));
  });
  it('maps only resource-route HTTP 404 to absence', async () => {
    http.mockResolvedValue(json({}, 404));
    expect(await provider().instances.getById('sb-one')).toBeNull();
  });
  it.each([null, {}, { sandboxId: '' }, { sandboxId: '  ' }, { sandboxId: 7 }, { sandboxId: 'other' }, { id: 'sb-one' }])('rejects malformed/mismatched lookup identity %j', async (data) => {
    http.mockResolvedValue(json({ success: true, data }));
    await expect(provider().instances.getById('sb-one')).rejects.toThrow(/identity/i);
  });
  it('does not hide retained terminal records', async () => {
    http.mockImplementation(async (url: string) => {
      if (url === config.baseURL + '/sandbox/sb-one') return json({ success: true, data: { sandboxId: 'sb-one', status: 'terminated' } });
      throw new Error('unexpected hydration route');
    });
    expect((await provider().instances.getById('sb-one'))?.instanceId).toBe('sb-one');
  });
  it.each(['getById', 'destroy'] as const)('%s preserves network failures by identity, not 404 text', async (method) => {
    const error = new Error('network 404 is not resource absence'); http.mockRejectedValue(error);
    await expect(provider().instances[method]('sb-one')).rejects.toBe(error);
  });
  it.each([401, 403, 429, 500])('destroy HTTP %s is not success and does not leak response bodies', async (status) => {
    http.mockResolvedValue(json({ error: 'private-body-marker' }, status));
    const error = await provider().instances.destroy('sb-one').catch(e => e);
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toContain(String(status));
    expect(error.message).not.toContain('private-body-marker');
  });
  it.each([204, 404])('destroy HTTP %s is an acknowledgement/idempotent missing', async (status) => {
    http.mockResolvedValue(new Response(null, { status }));
    await expect(provider().instances.destroy('sb-one')).resolves.toBeUndefined();
  });
  it('accepts the public JSON success acknowledgement', async () => {
    http.mockResolvedValue(json({ success: true }));
    await expect(provider().instances.destroy('sb-one')).resolves.toBeUndefined();
  });
  it.each([null, {}, 'ok', []])('rejects a malformed nonempty JSON destroy acknowledgement %j', async (ack) => {
    http.mockResolvedValue(json(ack));
    await expect(provider().instances.destroy('sb-one')).rejects.toThrow(/acknowledgement/i);
  });
  it.each([
    ['destroy', 'SECRETACK_PLACEHOLDER'],
    ['getById', 'SECRETGET_PLACEHOLDER'],
  ] as const)('%s does not expose malformed protocol body snippets through message/string/cause', async (method, sentinel) => {
    http.mockResolvedValue(new Response(sentinel, { headers: { 'content-type': 'application/json' } }));
    const error = await provider().instances[method]('sb-one').catch(e => e);
    expect(error).toBeInstanceOf(Error);
    // Native JSON parser messages can quote the first bytes of the body.
    // Check a short prefix too, rather than assuming the whole body is echoed.
    expect(error.message).not.toContain(sentinel.slice(0, 9));
    expect(String(error)).not.toContain(sentinel.slice(0, 9));
    expect(error.cause).toBeUndefined();
    expect(JSON.stringify(error)).not.toContain(sentinel.slice(0, 9));
  });
  it.each(['getById', 'destroy'] as const)('%s preserves response-stream failures rather than treating them as protocol parse errors', async (method) => {
    const error = new TypeError('response stream disconnected');
    const response = json({});
    vi.spyOn(response, method === 'getById' ? 'json' : 'text').mockRejectedValue(error);
    http.mockResolvedValue(response);
    await expect(provider().instances[method]('sb-one')).rejects.toBe(error);
  });
  it.each(['getById', 'destroy'] as const)('%s rejects failure envelopes even with HTTP 200', async (method) => {
    http.mockResolvedValue(json({ success: false, data: { sandboxId: 'sb-one' }, message: 'private-body-marker' }));
    await expect(provider().instances[method]('sb-one')).rejects.toThrow();
  });
  it.each(['getById', 'destroy'] as const)('%s propagates invalid JSON as failure', async (method) => {
    http.mockResolvedValue(new Response('{', { headers: { 'content-type': 'application/json' } }));
    await expect(provider().instances[method]('sb-one')).rejects.toThrow();
  });
  it.each([null, {}, { sandboxId: '' }, { sandboxId: '  ' }, { sandboxId: 7 }, { id: 'sb-one' }])('create rejects malformed native identity %j', async (data) => {
    http.mockResolvedValue(json({ success: true, data }));
    await expect(provider().instances.create()).rejects.toThrow(/identity/i);
  });
  it('creates with the canonical sandboxId field', async () => {
    http.mockResolvedValue(json({ success: true, data: { sandboxId: 'sb-one' } }));
    expect((await provider().instances.create()).instanceId).toBe('sb-one');
  });
});
