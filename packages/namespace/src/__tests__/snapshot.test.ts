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

const createCall = (calls: Array<{ url: string; body: any }>) =>
  calls.find((c) => c.url.includes('ComputeService/CreateInstance'))!;

describe('namespace snapshot volume on create', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('omits volumes when no snapshot volume is requested', async () => {
    const calls = mockFetch();
    const provider = namespace({ token: 'ns_test' });
    await provider.sandbox.create({} as any);
    expect(calls[0].body).not.toHaveProperty('volumes');
    expect(calls[0].body).not.toHaveProperty('labels');
    expect(calls[0].body.containers[0]).not.toHaveProperty('experimental');
  });

  it('attaches an opt-in persistent volume, binds it into the container and labels the instance', async () => {
    const calls = mockFetch();
    const provider = namespace({ token: 'ns_test' });
    await provider.sandbox.create({ snapshotVolume: true } as any);

    const body = createCall(calls).body;
    expect(body.volumes).toHaveLength(1);
    const [volume] = body.volumes;
    expect(volume).toMatchObject({
      mount_point: '/volumes/computesdk-snapshot',
      persistency_kind: 'PERSISTENT',
      size_mb: 1024,
    });
    expect(volume.tag).toMatch(/^computesdk-/);
    expect(volume).not.toHaveProperty('from_snapshot_id');
    expect(body.containers[0].experimental.host_mount).toEqual([
      { host_path: '/volumes/computesdk-snapshot', container_path: '/workspace' },
    ]);
    expect(body.labels).toContainEqual({ name: 'computesdk-snapshot-tag', value: volume.tag });
  });

  it('honors a factory-level snapshotVolume with custom path and size, keeping user labels', async () => {
    const calls = mockFetch();
    const provider = namespace({ token: 'ns_test', snapshotVolume: { mountPath: '/data', sizeMb: 4096 } });
    await provider.sandbox.create({ instanceOptions: { labels: [{ name: 'team', value: 'x' }] } } as any);

    const body = createCall(calls).body;
    expect(body.volumes[0].size_mb).toBe(4096);
    expect(body.containers[0].experimental.host_mount[0].container_path).toBe('/data');
    expect(body.labels[0]).toEqual({ name: 'team', value: 'x' });
    expect(body.labels).toContainEqual({
      name: 'computesdk-snapshot-mount',
      value: Buffer.from('/data').toString('base64url'),
    });
  });

  it('defaults command cwd to the snapshot volume', async () => {
    const calls = mockFetch((url) => (url.includes('RunCommandSync') ? { stdout: '', exitCode: 0 } : createdInstance));
    const provider = namespace({ token: 'ns_test' });
    const sandbox = await provider.sandbox.create({ snapshotVolume: true } as any);
    await sandbox.runCommand('pwd');
    await sandbox.runCommand('pwd', { cwd: '/tmp' });

    const runs = calls.filter((c) => c.url.includes('RunCommandSync'));
    expect(runs[0].body.command.cwd).toBe('/workspace');
    expect(runs[1].body.command.cwd).toBe('/tmp');
  });

  it('restores from snapshotId into the source tag, sized from the source volume', async () => {
    const calls = mockFetch((url) =>
      url.includes('DescribePersistentVolume')
        ? { volume: { id: 'vol_1', tag: 'computesdk-aa', sizeMb: 2048, site: 'iad3-a.nscluster.cloud' } }
        : createdInstance,
    );
    const provider = namespace({ token: 'ns_test' });
    const { sandboxId } = await provider.sandbox.create({ snapshotId: 'computesdk-aa/vol_1' } as any);

    expect(sandboxId).toBe('inst-123');
    const describe = calls.find((c) => c.url.includes('StorageService/DescribePersistentVolume'));
    expect(describe?.body).toEqual({ id: 'vol_1', tag: 'computesdk-aa' });
    const body = createCall(calls).body;
    expect(body.volumes[0]).toEqual({
      mount_point: '/volumes/computesdk-snapshot',
      tag: 'computesdk-aa',
      persistency_kind: 'PERSISTENT',
      size_mb: 2048,
      from_snapshot_id: 'vol_1',
    });
    expect(body.containers[0].experimental.host_mount).toEqual([
      { host_path: '/volumes/computesdk-snapshot', container_path: '/workspace' },
    ]);
    expect(body.labels).toContainEqual({ name: 'computesdk-snapshot-tag', value: 'computesdk-aa' });
    expect(body.placement).toEqual(['cell:iad3-a']);
  });

  it('falls back to the default size when the source volume cannot be described', async () => {
    const calls = mockFetch((url) =>
      url.includes('DescribePersistentVolume')
        ? new Response(JSON.stringify({ code: 'not_found', message: 'nope' }), { status: 404 })
        : createdInstance,
    );
    const provider = namespace({ token: 'ns_test' });
    await provider.sandbox.create({ snapshotId: 'computesdk-aa/vol_1' } as any);
    expect(createCall(calls).body.volumes[0].size_mb).toBe(1024);
    expect(createCall(calls).body).not.toHaveProperty('placement');
  });

  it('rejects snapshot ids that are not <tag>/<volumeId>', async () => {
    mockFetch();
    const provider = namespace({ token: 'ns_test' });
    await expect(provider.sandbox.create({ snapshotId: 'snap_abc' } as any)).rejects.toThrow(/<volumeTag>\/<volumeId>/);
  });
});

describe('namespace snapshot manager', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('destroys the source and returns the committed volume snapshot', async () => {
    let polls = 0;
    const calls = mockFetch((url) => {
      if (url.includes('DescribeInstance')) {
        return {
          metadata: {
            instanceId: 'inst-123',
            labels: [{ name: 'computesdk-snapshot-tag', value: 'computesdk-aa' }],
          },
        };
      }
      if (url.includes('ListPersistentVolumeSnapshots')) {
        polls++;
        const committed = polls > 2;
        return {
          snapshots: [
            { id: 'vol_old', completedSnapshot: 'gen_0', releasedAt: '2026-01-01T00:00:00Z', attachedInstanceId: 'inst-0' },
            {
              id: 'vol_1',
              attachedInstanceId: 'inst-123',
              ...(committed && { completedSnapshot: 'gen_1', releasedAt: '2026-01-02T00:00:00Z' }),
            },
          ],
        };
      }
      return {};
    });

    const provider = namespace({ token: 'ns_test' });
    const snapshot = await provider.snapshot!.create('inst-123', { name: 'snap' });

    expect(snapshot).toMatchObject({
      id: 'computesdk-aa/vol_1',
      provider: 'namespace',
      metadata: { volumeId: 'vol_1', volumeTag: 'computesdk-aa', generationId: 'gen_1', sourceInstance: 'inst-123', name: 'snap' },
    });
    expect(snapshot.createdAt).toEqual(new Date('2026-01-02T00:00:00Z'));
    const urls = calls.map((c) => c.url.split('/').pop());
    expect(urls.indexOf('DestroyInstance')).toBeGreaterThan(urls.indexOf('ListPersistentVolumeSnapshots'));
    expect(calls.find((c) => c.url.includes('DestroyInstance'))?.body.instance_id).toBe('inst-123');
    expect(calls.filter((c) => c.url.includes('ListPersistentVolumeSnapshots')).every((c) => c.body.tag === 'computesdk-aa')).toBe(true);
  });

  it('refuses to snapshot a sandbox without a snapshot volume, leaving it running', async () => {
    const calls = mockFetch((url) => (url.includes('DescribeInstance') ? { metadata: { instanceId: 'inst-123', labels: [] } } : {}));
    const provider = namespace({ token: 'ns_test' });
    await expect(provider.snapshot!.create('inst-123')).rejects.toThrow(/snapshotVolume/);
    expect(calls.some((c) => c.url.includes('DestroyInstance'))).toBe(false);
  });

  it('times out when the snapshot never commits', async () => {
    mockFetch((url) => {
      if (url.includes('DescribeInstance')) {
        return { metadata: { instanceId: 'inst-123', labels: [{ name: 'computesdk-snapshot-tag', value: 'computesdk-aa' }] } };
      }
      if (url.includes('ListPersistentVolumeSnapshots')) {
        return { snapshots: [{ id: 'vol_1', attachedInstanceId: 'inst-123' }] };
      }
      return {};
    });
    const provider = namespace({ token: 'ns_test', snapshotTimeoutMs: 50 });
    await expect(provider.snapshot!.create('inst-123')).rejects.toThrow(/did not commit/);
  });

  // Snapshot records are only listed per tag, and carry no tag themselves.
  it('lists committed snapshots per volume tag', async () => {
    const calls = mockFetch((url, body) => {
      if (url.includes('ListPersistentVolumes')) {
        return { volumes: [{ id: 'vol_2', tag: 'computesdk-aa' }, { id: 'vol_3', tag: 'computesdk-aa' }, { id: 'vol_9', tag: 'other' }] };
      }
      if (url.includes('ListPersistentVolumeSnapshots')) {
        if (body.tag === 'other') {
          return { snapshots: [{ id: 'vol_9', completedSnapshot: 'gen_9', releasedAt: '2026-01-05T00:00:00Z', attachedInstanceId: 'inst-1' }] };
        }
        return {
          snapshots: [
            { id: 'vol_1', completedSnapshot: 'gen_1', releasedAt: '2026-01-01T00:00:00Z', attachedInstanceId: 'inst-1' },
            { id: 'vol_2', snapshotFrom: 'vol_1', completedSnapshot: 'gen_2', releasedAt: '2026-01-02T00:00:00Z', attachedInstanceId: 'inst-2' },
            { id: 'vol_3', snapshotFrom: 'vol_1', attachedInstanceId: 'inst-3' },
            { id: 'vol_4', completedSnapshot: 'gen_4', releasedAt: '2026-01-03T00:00:00Z', abandonedAt: '2026-01-04T00:00:00Z' },
          ],
        };
      }
      return createdInstance;
    });

    const provider = namespace({ token: 'ns_test' });
    const snapshots = await provider.snapshot!.list();
    expect(snapshots.map((s: any) => s.id)).toEqual(['other/vol_9', 'computesdk-aa/vol_2', 'computesdk-aa/vol_1']);
    expect(snapshots[1].metadata).toMatchObject({ volumeId: 'vol_2', volumeTag: 'computesdk-aa', generationId: 'gen_2', snapshotFrom: 'vol_1', sourceInstance: 'inst-2' });
    expect(calls.filter((c) => c.url.includes('ListPersistentVolumeSnapshots')).map((c) => c.body.tag).sort()).toEqual(['computesdk-aa', 'other']);

    expect((await provider.snapshot!.list({ sandboxId: 'inst-1', limit: 1 })).map((s: any) => s.id)).toEqual(['other/vol_9']);
  });

  it('abandons a snapshot by its volume id + tag', async () => {
    const calls = mockFetch(() => ({}));
    const provider = namespace({ token: 'ns_test' });
    await provider.snapshot!.delete('computesdk-aa/vol_1');

    const destroy = calls.find((c) => c.url.includes('StorageService/DestroyPersistentVolumeSnapshot'));
    expect(destroy?.body).toEqual({ id: 'vol_1', tag: 'computesdk-aa' });
  });
});
