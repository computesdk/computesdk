import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { superserve } from '../index';

describe('superserve cleanup', () => {
  const fetchMock = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>();
  const provider = superserve({ apiKey: 'test', baseUrl: 'https://api.example.com/v1' });

  beforeEach(() => {
    vi.useFakeTimers();
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it.each([204, 404])('accepts a confirmed deletion or absence (%i)', async (status) => {
    fetchMock.mockResolvedValue(new Response(null, { status }));

    await expect(provider.instances.destroy('sb-test')).resolves.toBeUndefined();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith('https://api.example.com/v1/sandboxes/sb-test',
      expect.objectContaining({ method: 'DELETE', headers: expect.objectContaining({ 'X-API-Key': 'test' }) }));
  });

  it.each([401, 403, 500])('reports a failed deletion (%i) with its API error details', async (status) => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({
      error: { code: 'delete_failed', message: 'Deletion failed' },
    }), { status }));

    await expect(provider.instances.destroy('sb-test')).rejects.toMatchObject({
      statusCode: status, code: 'delete_failed', message: 'Deletion failed',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([204, 404])('retries a transient failure until deletion is confirmed (%i)', async (status) => {
    fetchMock
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(new Response(null, { status }));

    const result = expect(provider.instances.destroy('sb-test')).resolves.toBeUndefined();
    await vi.runAllTimersAsync();
    await result;

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it.each([429, 503])('reports failure when transient retries are exhausted (%i)', async (status) => {
    fetchMock.mockImplementation(async () => new Response(null, { status }));

    const result = expect(provider.instances.destroy('sb-test')).rejects.toMatchObject({ statusCode: status });
    await vi.runAllTimersAsync();
    await result;

    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('reports network failure after retries, preserving the cause', async () => {
    const cause = new TypeError('fetch failed');
    fetchMock.mockRejectedValue(cause);

    const result = expect(provider.instances.destroy('sb-test')).rejects.toMatchObject({ cause });
    await vi.runAllTimersAsync();
    await result;

    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('reports a timed-out deletion instead of claiming success', async () => {
    fetchMock.mockImplementation((_input, init) => new Promise((_resolve, reject) => {
      init!.signal!.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true });
    }));

    const result = expect(provider.instances.destroy('sb-test')).rejects.toMatchObject({ name: 'TimeoutError' });
    await vi.runAllTimersAsync();
    await result;
  });
});
