import { describe, expect, it, vi } from 'vitest';
import { RunCloudError } from '@run-cloud/sdk';
import { runCloud } from '../index';

// Real provider factory AND installed @run-cloud/sdk 0.15.0. Only its public
// fetch boundary is replaced; no provider/core/native classes are mocked.
const apiUrl = 'https://runcloud.invalid';
const id = 'sbx/opaque ?#%+';
const target = `${apiUrl}/run-cloud/sandboxes/${encodeURIComponent(id)}`;
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
const provider = (fetch: typeof globalThis.fetch) =>
  runCloud({ apiKey: 'dummy-runcloud-key', apiUrl, fetch });

describe('Run Cloud real-factory/native transport lifecycle contract', () => {
  it.each([
    { status: 404 },
    Object.assign(new Error('not found'), { status: 404 }),
    Object.assign(new Error('not found'), { name: 'RunCloudError', status: 404 }),
    new TypeError('transport failure'),
    new Error('sandbox not found'),
    new RunCloudError(403, 'not found'),
    '404',
  ])('preserves original nonauthoritative GET/DELETE failure %#', async (error) => {
    // Native Client.request rethrows transport failures unchanged. A plain
    // status-shaped exception is not an HTTP response from this target.
    const fetch = vi.fn().mockRejectedValue(error);
    const sdk = provider(fetch);
    await expect(sdk.instances.getById(id)).rejects.toBe(error);
    await expect(sdk.instances.destroy(id)).rejects.toBe(error);
    expect(fetch.mock.calls.map(([url, init]) => [url, init.method])).toEqual([
      [target, 'GET'],
      [target, 'DELETE'],
    ]);
  });

  it('recognizes native HTTP 404 only in the configured visibility scope', async () => {
    // Public docs: 404 also covers a sandbox in another organization. This is
    // scoped API nonvisibility, not global/physical absence or billing proof.
    const fetch = vi.fn(async () => json({ detail: 'No such sandbox' }, 404));
    const sdk = provider(fetch);
    await expect(sdk.instances.getById(id)).resolves.toBeNull();
    await expect(sdk.instances.destroy(id)).resolves.toBeUndefined();
    expect(fetch.mock.calls).toHaveLength(2);
  });

  it.each([401, 402, 403, 409, 429, 500, 503])(
    'propagates actual native HTTP %i failures for GET and DELETE',
    async (status) => {
      const fetch = vi.fn(async () =>
        json({ detail: 'original API failure', code: 'original-code' }, status),
      );
      const sdk = provider(fetch);
      for (const operation of [
        () => sdk.instances.getById(id),
        () => sdk.instances.destroy(id),
      ]) {
        await expect(operation()).rejects.toMatchObject({
          name: 'RunCloudError', status,
          detail: 'original API failure', code: 'original-code',
        });
      }
      expect(fetch.mock.calls).toHaveLength(2);
    },
  );

  it('does not interpret a body code/message as HTTP absence', async () => {
    const fetch = vi.fn(async () =>
      json({ detail: 'sandbox not found', code: '404' }, 500),
    );
    const sdk = provider(fetch);
    await expect(sdk.instances.getById(id)).rejects.toMatchObject({ status: 500 });
    await expect(sdk.instances.destroy(id)).rejects.toMatchObject({ status: 500 });
  });

  it('awaits direct DELETE, with no lookup, pause, resume or terminal inference', async () => {
    let acknowledge!: (response: Response) => void;
    const fetch = vi.fn(() => new Promise<Response>(resolve => { acknowledge = resolve; }));
    let finished = false;
    const operation = provider(fetch).instances.destroy(id).then(() => { finished = true; });
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    expect(finished).toBe(false);
    expect(fetch.mock.calls[0]).toEqual([
      target,
      expect.objectContaining({ method: 'DELETE', body: undefined }),
    ]);
    acknowledge(new Response(null, { status: 204 }));
    await operation;
    expect(finished).toBe(true);
    expect(fetch).toHaveBeenCalledOnce();
  });

  it.each(['paused', 'stopped', 'interrupted', 'destroying', 'destroyed'])(
    'keeps retained %s records visible and refreshes getInfo from native GET',
    async (state) => {
      let currentState = 'running';
      const calls: Array<[string, string | undefined]> = [];
      const fetch: typeof globalThis.fetch = vi.fn(async (url, init) => {
        calls.push([String(url), init?.method]);
        if (String(url).endsWith('/fs')) {
          // The real factory's best-effort egress pointer read, not lifecycle
          // lookup or an absence oracle. No guest command/daemon is executed.
          return json({ error: 'no egress pointer' });
        }
        if (init?.method === 'DELETE') return new Response(null, { status: 204 });
        return json({
          id, state: currentState,
          created_at: '2026-11-03T22:11:37.102Z',
          state_changed_at: '2026-11-03T22:11:38.663Z',
        });
      });
      const sdk = provider(fetch);
      const sandbox = await sdk.instances.create();
      expect(sandbox.instanceId).toBe(id);
      await sandbox.destroy();
      currentState = state;
      // DELETE acknowledgment never makes the retained record disappear.
      const retained = await sdk.instances.getById(id);
      expect(retained?.instanceId).toBe(id);
      expect(retained?.getInstance().sandbox.state).toBe(state);
      const beforeInfo = calls.length;
      const info = await sandbox.getInfo();
      expect(calls.slice(beforeInfo)).toEqual([[target, 'GET']]);
      expect(info.id).toBe(id);
      expect(info.metadata?.state).toBe(state);
      expect(sandbox.getInstance().sandbox.state).toBe(state);
      expect(calls.filter(([, method]) => method === 'DELETE')).toEqual([[target, 'DELETE']]);
      expect(calls.some(([url]) => /\/(?:pause|resume|stop)$/.test(url))).toBe(false);
    },
  );
});
