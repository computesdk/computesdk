import { afterEach, describe, expect, it, vi } from 'vitest';
import { namespace } from '../index';

const createdInstance = {
  metadata: { instanceId: 'inst-123' },
  extendedMetadata: { commandServiceEndpoint: 'https://cmd.example.com' },
};

function mockFetch(handler?: (url: string, body: any) => any) {
  const calls: Array<{ url: string; body: any }> = [];
  const spy = vi.fn(async (url: any, init: any) => {
    const body = init?.body ? JSON.parse(init.body) : {};
    calls.push({ url: String(url), body });
    const data = handler ? handler(String(url), body) : createdInstance;
    if (data instanceof Response) return data;
    return {
      ok: true,
      json: async () => data,
    } as any;
  });
  vi.stubGlobal('fetch', spy);
  return calls;
}

describe('namespace create from snapshot', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('seeds a persistent volume from snapshotId', async () => {
    const calls = mockFetch();
    const provider = namespace({ token: 'ns_test' });
    const { sandboxId } = await provider.sandbox.create({
      snapshotId: 'snap_abc',
    } as any);

    expect(sandboxId).toBe('inst-123');
    const volume = calls[0].body.volumes[0];
    expect(calls[0].url).toContain('ComputeService/CreateInstance');
    expect(volume.persistency_kind).toBe('PERSISTENT');
    expect(volume.from_snapshot_id).toBe('snap_abc');
    expect(volume.mount_point).toBe('/computesdk-data');
    expect(volume.tag).toMatch(/^computesdk-/);
  });

  it('omits volumes when snapshotId is not passed', async () => {
    const calls = mockFetch();
    const provider = namespace({ token: 'ns_test' });
    await provider.sandbox.create({} as any);
    expect(calls[0].body).not.toHaveProperty('volumes');
  });
});

describe('namespace snapshot manager', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('rejects on-demand snapshot creation', async () => {
    const provider = namespace({ token: 'ns_test' });
    await expect(provider.snapshot!.create('inst-123')).rejects.toThrow(
      /cannot create snapshots on demand/i,
    );
  });

  // The records listing is workspace-wide whatever the request body — the
  // record's `id` is the VOLUME id, `completedSnapshot` the generation.
  it('lists snapshots joined to their volumes', async () => {
    mockFetch((url) => {
      if (url.includes('ListPersistentVolumes')) {
        return {
          volumes: [
            { id: 'vol_1', tag: 'computesdk-aa', site: 'iad' },
            { id: 'vol_2', tag: 'other', site: 'ord' },
          ],
        };
      }
      if (url.includes('ListPersistentVolumeSnapshots')) {
        return {
          snapshots: [
            {
              id: 'vol_1',
              completedSnapshot: 'gen_1',
              createdAt: '2026-01-02T00:00:00Z',
              attachedInstanceId: 'inst-123',
            },
            {
              id: 'vol_2',
              completedSnapshot: 'gen_2',
              createdAt: '2026-01-01T00:00:00Z',
            },
          ],
        };
      }
      return createdInstance;
    });

    const provider = namespace({ token: 'ns_test' });
    const snapshots = await provider.snapshot!.list();

    expect(snapshots.map((s: any) => s.id)).toEqual([
      'computesdk-aa/gen_1',
      'other/gen_2',
    ]);
    expect(snapshots[0].metadata).toMatchObject({
      volumeId: 'vol_1',
      generationId: 'gen_1',
      volumeTag: 'computesdk-aa',
      sourceInstance: 'inst-123',
    });
  });

  it('filters snapshots by sandboxId and honors limit', async () => {
    mockFetch((url) => {
      if (url.includes('ListPersistentVolumes')) {
        return { volumes: [{ id: 'vol_1' }] };
      }
      if (url.includes('ListPersistentVolumeSnapshots')) {
        return {
          snapshots: [
            { id: 'vol_1', completedSnapshot: 'gen_1', attachedInstanceId: 'inst-123' },
            { id: 'vol_2', completedSnapshot: 'gen_2', attachedInstanceId: 'inst-999' },
          ],
        };
      }
      return createdInstance;
    });

    const provider = namespace({ token: 'ns_test' });
    const snapshots = await provider.snapshot!.list({ sandboxId: 'inst-123' });
    expect(snapshots.map((s: any) => s.id)).toEqual(['gen_1']);
  });

  it('abandons a snapshot by its volume id + tag', async () => {
    const calls = mockFetch((url) => {
      if (url.includes('ListPersistentVolumes')) {
        return { volumes: [{ id: 'vol_1', tag: 'computesdk-aa' }] };
      }
      if (url.includes('ListPersistentVolumeSnapshots')) {
        return {
          snapshots: [{ id: 'vol_1', completedSnapshot: 'gen_1' }],
        };
      }
      return {};
    });
    const provider = namespace({ token: 'ns_test' });
    await provider.snapshot!.delete('computesdk-aa/gen_1');

    const destroy = calls.find((c) =>
      c.url.includes('StorageService/DestroyPersistentVolumeSnapshot'),
    );
    expect(destroy?.body).toEqual({ id: 'vol_1', tag: 'computesdk-aa' });
  });
});
