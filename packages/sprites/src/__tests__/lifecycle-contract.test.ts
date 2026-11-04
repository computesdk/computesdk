import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sprites } from '../index';

// There is no native Sprites SDK dependency in this adapter. Mock only its
// actual native boundary (HTTP fetch), never the ComputeSDK factory.
const http = vi.fn();
const name = 'opaque/sprite ?#%';
const baseUrl = 'https://sprites.invalid/custom/v1';
const config = { apiKey: 'mock-config-token', baseUrl };
const endpoint = `${baseUrl}/sprites/${encodeURIComponent(name)}`;
const failureStatuses = [400, 401, 403, 408, 429, 500, 503];

beforeEach(() => {
  http.mockReset();
  vi.stubGlobal('fetch', http);
});

afterEach(() => { vi.unstubAllGlobals(); });

describe('Sprites lifecycle contract (native HTTP mocks)', () => {
  it('queries existence and returns the native opaque name with explicit config', async () => {
    http.mockImplementation(async (url: string) => {
      if (url === endpoint) return new Response(JSON.stringify({ id: 'native-id', name }));
      // The real factory may probe its egress pointer after positive lookup.
      if (new URL(url).pathname.endsWith('/fs/read')) return new Response('', { status: 404 });
      throw new Error('Unexpected HTTP operation');
    });
    const instance = await sprites(config).instances.getById(name);
    expect(instance?.sandboxId).toBe(name);
    expect(http).toHaveBeenNthCalledWith(1, endpoint, {
      method: 'GET', headers: { Authorization: 'Bearer mock-config-token' },
    });
  });

  it('returns null only for a real numeric HTTP 404', async () => {
    http.mockResolvedValue(new Response('missing', { status: 404 }));
    await expect(sprites(config).instances.getById(name)).resolves.toBeNull();
    expect(http).toHaveBeenCalledOnce();
    expect(http).toHaveBeenCalledWith(endpoint, {
      method: 'GET', headers: { Authorization: 'Bearer mock-config-token' },
    });
  });

  it.each(failureStatuses)('lookup rejects HTTP %s instead of returning null', async status => {
    http.mockResolvedValue(new Response('404 NotFoundError is only body text', { status }));
    await expect(sprites(config).instances.getById(name)).rejects.toThrow(String(status));
    expect(http).toHaveBeenCalledOnce();
  });

  it.each([
    new TypeError('network failure'),
    new Error('404 Not Found'),
    Object.assign(new Error('unauthorized'), { name: 'NotFoundError' }),
    Object.assign(new Error('connection rejected'), { status: '404' }),
  ])('lookup preserves rejected fetch errors, not message/name guesses (%s)', async error => {
    http.mockRejectedValue(error);
    await expect(sprites(config).instances.getById(name)).rejects.toBe(error);
  });

  it('does not convert malformed positive JSON into absence', async () => {
    http.mockResolvedValue(new Response('not-json'));
    await expect(sprites(config).instances.getById(name)).rejects.toBeInstanceOf(SyntaxError);
  });

  it.each([{}, { name: 'different-name' }, { name: '' }, null])(
    'rejects a positive response without matching native name identity (%s)',
    async data => {
      http.mockResolvedValue(new Response(JSON.stringify(data)));
      await expect(sprites(config).instances.getById(name)).rejects.toThrow('identity');
    },
  );

  it('propagates rejected positive response decoding', async () => {
    const error = new TypeError('response stream disconnected');
    http.mockResolvedValue({ ok: true, status: 200, json: vi.fn().mockRejectedValue(error) });
    await expect(sprites(config).instances.getById(name)).rejects.toBe(error);
  });

  it.each([204, 404])('destroy completes on HTTP %s (deleted or documented absence)', async status => {
    http.mockResolvedValue(new Response(null, { status }));
    await expect(sprites(config).instances.destroy(name)).resolves.toBeUndefined();
    expect(http).toHaveBeenCalledOnce();
    expect(http).toHaveBeenCalledWith(endpoint, {
      method: 'DELETE', headers: { Authorization: 'Bearer mock-config-token' },
    });
  });

  it.each(failureStatuses)('destroy rejects HTTP %s instead of claiming success', async status => {
    http.mockResolvedValue(new Response('404 NotFoundError is only body text', { status }));
    await expect(sprites(config).instances.destroy(name)).rejects.toThrow(String(status));
    expect(http).toHaveBeenCalledOnce();
  });

  it.each([
    new TypeError('network failure'),
    new Error('404 Not Found'),
    Object.assign(new Error('unauthorized'), { name: 'NotFoundError' }),
    Object.assign(new Error('connection rejected'), { status: '404' }),
  ])('destroy preserves rejected fetch errors (%s)', async error => {
    http.mockRejectedValue(error);
    await expect(sprites(config).instances.destroy(name)).rejects.toBe(error);
  });
});
