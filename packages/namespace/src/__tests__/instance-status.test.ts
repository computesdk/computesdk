import { afterEach, describe, expect, it, vi } from 'vitest';
import { namespace } from '../index';

function mockFetch(respond: (url: string, body: any) => any) {
  const spy = vi.fn(async (url: any, init: any) => {
    const body = init?.body ? JSON.parse(init.body) : {};
    const out = respond(String(url), body);
    if (out instanceof Error) {
      return { ok: false, status: 500, statusText: out.message, json: async () => ({}) } as any;
    }
    if (out && typeof out === 'object' && '__status' in out) {
      const { __status, __statusText = '' } = out as any;
      return { ok: false, status: __status, statusText: __statusText, json: async () => ({}) } as any;
    }
    return { ok: true, json: async () => out } as any;
  });
  vi.stubGlobal('fetch', spy);
  return spy;
}

const describeUrl = 'DescribeInstance';
const listUrl = 'ListInstances';
const destroyUrl = 'DestroyInstance';

describe('namespace instance lifecycle status', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('getById returns the instance while it is RUNNING', async () => {
    mockFetch(() => ({
      metadata: { instanceId: 'inst-1', status: 'RUNNING' },
      extendedMetadata: { commandServiceEndpoint: 'https://cmd.example.com' },
    }));
    const provider = namespace({ token: 'ns_test' });
    const found = await provider.sandbox.getById('inst-1');
    expect(found).not.toBeNull();
    expect(found!.sandbox.instanceId).toBe('inst-1');
    expect(found!.sandbox.status).toBe('running');
  });

  it.each(['DESTROYING', 'DESTROYED', 5, 4])(
    'getById returns null once the instance is %s',
    async (status) => {
      mockFetch(() => ({ metadata: { instanceId: 'inst-1', status } }));
      const provider = namespace({ token: 'ns_test' });
      expect(await provider.sandbox.getById('inst-1')).toBeNull();
    },
  );

  it('list skips destroying and destroyed instances', async () => {
    mockFetch(() => ({
      instances: [
        { metadata: { instanceId: 'a', status: 'RUNNING' } },
        { metadata: { instanceId: 'b', status: 'DESTROYING' } },
        { metadata: { instanceId: 'c', status: 'DESTROYED' } },
      ],
    }));
    const provider = namespace({ token: 'ns_test' });
    const all = await provider.sandbox.list();
    expect(all.map((s) => s.sandboxId)).toEqual(['a']);
  });

  it('destroy rejects when the API call fails instead of warning', async () => {
    mockFetch(() => new Error('Internal Server Error'));
    const provider = namespace({ token: 'ns_test' });
    await expect(provider.sandbox.destroy('inst-1')).rejects.toThrow(
      'Failed to destroy Namespace instance',
    );
  });

  it('routes describe, list and destroy calls to their own endpoints', async () => {
    const spy = mockFetch((url) => {
      if (url.includes(destroyUrl)) return {};
      if (url.includes(listUrl)) return { instances: [] };
      return { metadata: { instanceId: 'inst-1', status: 'RUNNING' } };
    });
    const provider = namespace({ token: 'ns_test' });
    await provider.sandbox.destroy('inst-1');
    await provider.sandbox.list();
    await provider.sandbox.getById('inst-1');
    const urls = spy.mock.calls.map(([url]) => String(url));
    expect(urls.some((u) => u.includes(destroyUrl))).toBe(true);
    expect(urls.some((u) => u.includes(listUrl))).toBe(true);
    expect(urls.some((u) => u.includes(describeUrl))).toBe(true);
  });

  it('getInfo re-describes the instance so a stale handle sees destruction', async () => {
    let status: string | number = 'RUNNING';
    mockFetch(() => ({ metadata: { instanceId: 'inst-1', status } }));
    const provider = namespace({ token: 'ns_test' });
    const found = await provider.sandbox.getById('inst-1');
    expect((await found!.getInfo()).status).toBe('running');

    status = 'DESTROYED';
    expect((await found!.getInfo()).status).toBe('stopped');
  });

  it('getInfo maps a describe 404 to stopped once the instance is gone', async () => {
    let gone = false;
    mockFetch(() =>
      gone
        ? { __status: 404, __statusText: 'Not Found' }
        : { metadata: { instanceId: 'inst-1', status: 'RUNNING' } },
    );
    const provider = namespace({ token: 'ns_test' });
    const found = await provider.sandbox.getById('inst-1');
    gone = true;
    expect((await found!.getInfo()).status).toBe('stopped');
    // And the refreshed state sticks on the handle.
    expect(found!.sandbox.status).toBe('destroyed');
  });

  it('getInfo falls back to running for unrecognized statuses', async () => {
    mockFetch(() => ({ metadata: { instanceId: 'inst-1', status: 0 } }));
    const provider = namespace({ token: 'ns_test' });
    const found = await provider.sandbox.getById('inst-1');
    expect((await found!.getInfo()).status).toBe('running');
  });
});
