import { afterEach, describe, expect, it, vi } from 'vitest';
import { namespace } from '../index';

function mockFetch(handler: (url: string, body: any) => any) {
  const calls: Array<{ url: string; body: any }> = [];
  const spy = vi.fn(async (url: any, init: any) => {
    const body = init?.body ? JSON.parse(init.body) : {};
    calls.push({ url: String(url), body });
    return { ok: true, json: async () => handler(String(url), body) } as any;
  });
  vi.stubGlobal('fetch', spy);
  return calls;
}

const listCalls = (calls: Array<{ url: string }>, method: string) =>
  calls.filter((c) => c.url.includes(method));

// Namespace's Connect JSON answers list pages with a lowerCamelCase
// `paginationCursor`; the proto snake_case name is accepted too. Reading only
// the snake_case name truncated every listing to its first page.
describe('namespace list pagination (mock-only)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('follows paginationCursor across ListInstances pages', async () => {
    const pages = [
      { instances: [{ metadata: { instanceId: 'a', status: 'RUNNING' } }], paginationCursor: 'c1' },
      { instances: [{ metadata: { instanceId: 'b', status: 'RUNNING' } }], paginationCursor: 'c2' },
      { instances: [{ metadata: { instanceId: 'c', status: 'DESTROYING' } }] },
    ];
    const calls = mockFetch(() => pages.shift()!);
    const provider = namespace({ token: 'ns_test' });

    const all = await provider.sandbox.list();

    expect(all.map((s) => s.sandboxId)).toEqual(['a', 'b']);
    const list = listCalls(calls, 'ListInstances');
    expect(list).toHaveLength(3);
    expect((list[0] as any).body).toEqual({});
    expect((list[1] as any).body).toEqual({ pagination_cursor: 'c1' });
    expect((list[2] as any).body).toEqual({ pagination_cursor: 'c2' });
  });

  it('accepts the snake_case pagination_cursor name too', async () => {
    const pages = [
      { instances: [{ metadata: { instanceId: 'a', status: 'RUNNING' } }], pagination_cursor: 'c1' },
      { instances: [{ metadata: { instanceId: 'b', status: 'RUNNING' } }] },
    ];
    const calls = mockFetch(() => pages.shift()!);
    const provider = namespace({ token: 'ns_test' });

    const all = await provider.sandbox.list();

    expect(all.map((s) => s.sandboxId)).toEqual(['a', 'b']);
    expect(listCalls(calls, 'ListInstances')).toHaveLength(2);
  });

  it('does not loop forever when the server repeats a cursor', async () => {
    const calls = mockFetch(() => ({ instances: [], paginationCursor: 'same' }));
    const provider = namespace({ token: 'ns_test' });

    expect(await provider.sandbox.list()).toEqual([]);
    // One page to discover the cursor, one more to see it repeat, then stop.
    expect(listCalls(calls, 'ListInstances')).toHaveLength(2);
  });

  it('follows paginationCursor across volume pages', async () => {
    const pages = [
      { volumes: [{ tag: 'v1' }], paginationCursor: 'c1' },
      { volumes: [{ tag: 'v2' }] },
    ];
    const calls = mockFetch(() => pages.shift()!);
    const provider = namespace({ token: 'ns_test' });

    const volumes = await provider.volume!.list();

    expect(volumes.map((v: any) => v.id)).toEqual(['v1', 'v2']);
    expect(listCalls(calls, 'ListPersistentVolumes')).toHaveLength(2);
  });

  it('stops volume pagination once the requested limit is reached', async () => {
    const calls = mockFetch(() => ({ volumes: [{ tag: 'v1' }, { tag: 'v2' }], paginationCursor: 'c1' }));
    const provider = namespace({ token: 'ns_test' });

    const volumes = await provider.volume!.list({ limit: 1 });

    expect(volumes.map((v: any) => v.id)).toEqual(['v1']);
    expect(listCalls(calls, 'ListPersistentVolumes')).toHaveLength(1);
  });

  it('follows paginationCursor across snapshot-record pages when listing snapshots', async () => {
    const calls = mockFetch((url, body) => {
      if (url.includes('ListPersistentVolumes')) return { volumes: [{ tag: 'computesdk-aa' }] };
      if (url.includes('ListPersistentVolumeSnapshots')) {
        return body.pagination_cursor
          ? { snapshots: [{ id: 'vol_2', completedSnapshot: 'gen_2', releasedAt: '2026-01-02T00:00:00Z', attachedInstanceId: 'inst-2' }] }
          : {
              snapshots: [{ id: 'vol_1', completedSnapshot: 'gen_1', releasedAt: '2026-01-01T00:00:00Z', attachedInstanceId: 'inst-1' }],
              paginationCursor: 'c1',
            };
      }
      return {};
    });
    const provider = namespace({ token: 'ns_test' });

    const snapshots = await provider.snapshot!.list();

    expect(snapshots.map((s: any) => s.id).sort()).toEqual(['computesdk-aa/vol_1', 'computesdk-aa/vol_2']);
    expect(listCalls(calls, 'ListPersistentVolumeSnapshots')).toHaveLength(2);
  });
});
