import { Arker, ArkerError, type Filesystem, type Mount, type VM } from '@arker-ai/sdk';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { arker } from '../index';

const config = { apiKey: 'ark_test', keepAwake: false };
const FS_ID = 'dir_0123456789abcdefABCDEF';

const filesystem = (name: string, id = FS_ID): Filesystem =>
  ({ filesystem_id: id, name, owner_org_id: 'org', created_at: '2026-11-18T00:00:00Z' }) as Filesystem;

/**
 * A VM whose mounts each reach `mounted` after `pollsUntilMounted` listings of
 * their own, or end `failed`. Like Arker, it allows one path per volume and one
 * volume per path on a VM, compared as exact strings, and answers a repeated
 * mount with the one it has.
 */
function mockVm(opts: { pollsUntilMounted?: number; fail?: boolean } = {}) {
  const mounts: Mount[] = [];
  const polls = new Map<string, number>();
  const vm = {
    id: 'vm-new',
    _client: Arker.prototype,
    run: vi.fn(async (_command: string, _options?: unknown) => ({ stdout: '', stderr: '', exitCode: 0 })),
    createSession: vi.fn(async () => ({ session_id: 'sess-wait' })),
    deleteSession: vi.fn(async (_sessionId: string) => ({ deleted: true })),
    delete: vi.fn(async () => ({ deleted: true })),
    createMount: vi.fn(async ({ filesystemId, path }: { filesystemId: string; path?: string }) => {
      const existing = mounts.find((m) => m.filesystem_id === filesystemId && m.path === path);
      if (existing) return { ...existing };
      // One path per volume, and one volume per path, compared as exact strings.
      if (mounts.some((m) => (m.filesystem_id === filesystemId) !== (m.path === path))) {
        throw new ArkerError('conflict', 'The request conflicts with the mount.', 409);
      }
      const mount = { mount_id: `mnt-${mounts.length + 1}`, vm_id: 'vm-new', filesystem_id: filesystemId, path: path!, state: 'attaching' } as Mount;
      mounts.push(mount);
      return { ...mount };
    }),
    listMounts: vi.fn(async ({ filesystemId }: { filesystemId?: string } = {}) => {
      const listed = mounts.filter((m) => !filesystemId || m.filesystem_id === filesystemId);
      // A mount moves on as its own state is polled, not when the VM's mounts are listed.
      for (const m of filesystemId ? listed : []) {
        polls.set(m.mount_id, (polls.get(m.mount_id) ?? 0) + 1);
        if (polls.get(m.mount_id)! > (opts.pollsUntilMounted ?? 0)) m.state = opts.fail ? 'failed' : 'mounted';
      }
      return { mounts: listed.map((m) => ({ ...m })) };
    }),
    deleteMount: vi.fn(async (mountId: string) => {
      mounts.splice(mounts.findIndex((m) => m.mount_id === mountId), 1);
      return { deleted: true };
    }),
  };
  const fork = vi.spyOn(Arker.prototype, 'fork').mockResolvedValue(vm as unknown as VM);
  vi.spyOn(Arker.prototype, 'getFilesystem').mockResolvedValue(filesystem('data'));
  return { vm, fork, mounts };
}

describe('Arker OCI image (mock)', () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it('forks from the image, keeping placement and resources', async () => {
    const { fork } = mockVm();
    await arker({ ...config, platforms: ['graviton4'] }).instances.create({ image: 'ubuntu:24.04', name: 'oci', resources: { vcpu: 2 } });
    expect(fork).toHaveBeenCalledWith({ image: 'ubuntu:24.04', name: 'oci', platforms: ['graviton4'], resources: { vcpu: 2 }, idempotency: true });
  });

  it('does not size an image fork against golden bounds', () => {
    const support = arker(config).sizes.resolve('md', { image: 'ubuntu:24.04' });
    expect(support.status).toBe('unknown');
  });
});

describe('Arker volumes (mock)', () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it('creates a volume as an Arker filesystem', async () => {
    const create = vi.spyOn(Arker.prototype, 'createFilesystem').mockResolvedValue(filesystem('data'));
    const volume = await arker(config).volume!.create({ name: 'data', sizeBytes: 1 << 30 });
    expect(create).toHaveBeenCalledWith({ name: 'data' });
    expect(volume).toMatchObject({ id: FS_ID, name: 'data' });
  });

  it('gets a volume by id, or by exact name across pages, and null when there is none', async () => {
    vi.spyOn(Arker.prototype, 'getFilesystem').mockImplementation(async (id) => {
      if (id === FS_ID) return filesystem('data');
      throw new ArkerError('not_found', 'no such filesystem', 404);
    });
    const list = vi.spyOn(Arker.prototype, 'listFilesystems').mockImplementation(async (opts) =>
      opts?.cursor
        ? { filesystems: [filesystem('data', 'dir_bbbbbbbbbbbbbbbbbbbbbb')], next_cursor: null }
        : { filesystems: [filesystem('data-old', 'dir_aaaaaaaaaaaaaaaaaaaaaa')], next_cursor: 'p2' },
    );
    const volumes = arker(config).volume!;
    expect(await volumes.get(FS_ID)).toMatchObject({ id: FS_ID });
    expect(list).not.toHaveBeenCalled();
    expect(await volumes.get('data')).toMatchObject({ id: 'dir_bbbbbbbbbbbbbbbbbbbbbb', name: 'data' });
    expect(list.mock.calls[0][0]).toEqual({ namePrefix: 'data' });
    list.mockResolvedValue({ filesystems: [], next_cursor: null });
    expect(await volumes.get('dir_cccccccccccccccccccccc')).toBeNull();
  });

  it('lists every page, up to the limit', async () => {
    vi.spyOn(Arker.prototype, 'listFilesystems').mockImplementation(async (opts) =>
      opts?.cursor
        ? { filesystems: [filesystem('b', 'dir_bbbbbbbbbbbbbbbbbbbbbb')], next_cursor: null }
        : { filesystems: [filesystem('a', 'dir_aaaaaaaaaaaaaaaaaaaaaa')], next_cursor: 'p2' },
    );
    const volumes = arker(config).volume!;
    expect((await volumes.list()).map((v) => v.name)).toEqual(['a', 'b']);
    expect((await volumes.list({ limit: 1 })).map((v) => v.name)).toEqual(['a']);
    expect(Arker.prototype.listFilesystems).toHaveBeenLastCalledWith({ limit: 1 });
  });

  it('deletes by name, and treats a missing volume as deleted', async () => {
    vi.spyOn(Arker.prototype, 'listFilesystems').mockResolvedValue({ filesystems: [filesystem('data')], next_cursor: null });
    const del = vi.spyOn(Arker.prototype, 'deleteFilesystem').mockResolvedValue({ deleted: true });
    const volumes = arker(config).volume!;
    await volumes.delete('data');
    expect(del).toHaveBeenCalledWith(FS_ID);
    await volumes.delete('gone');
    expect(del).toHaveBeenCalledTimes(1);
  });

  it('mounts create-time volumes, waiting until the guest has them', async () => {
    const { vm } = mockVm({ pollsUntilMounted: 2 });
    vi.spyOn(Arker.prototype, 'listFilesystems').mockResolvedValue({ filesystems: [filesystem('cache', 'dir_cccccccccccccccccccccc')], next_cursor: null });
    await arker(config).instances.create({
      volumes: [{ volume: { id: FS_ID, name: 'data' }, mountPath: '/mnt/data' }, { volume: 'cache', mountPath: '/mnt/cache' }],
    });
    expect(vm.createMount.mock.calls).toEqual([
      [{ filesystemId: FS_ID, path: '/mnt/data' }],
      [{ filesystemId: 'dir_cccccccccccccccccccccc', path: '/mnt/cache' }],
    ]);
    // Each wait runs in the guest until the mount shows in /proc/mounts, in a session of its own, deleted after.
    expect(vm.run.mock.calls[0][0]).toMatch(/^\(.*grep -qsF ' \/mnt\/data ' \/proc\/mounts.*\)$/);
    expect(vm.run.mock.calls[0][1]).toMatchObject({ session_id: 'sess-wait', idempotencyKey: expect.any(String) });
    // It waits until Arker reports each mount `mounted`, not just made.
    expect(vm.listMounts.mock.calls.filter(([o]) => o?.filesystemId === FS_ID)).toHaveLength(3);
    expect(vm.deleteSession).toHaveBeenCalledTimes(2);
    expect(vm.delete).not.toHaveBeenCalled();
  });

  it('resolves volumes before forking, so a missing one costs no VM', async () => {
    const { fork } = mockVm();
    vi.spyOn(Arker.prototype, 'listFilesystems').mockResolvedValue({ filesystems: [], next_cursor: null });
    const err = await arker(config).instances.create({ volumes: [{ volume: 'attached-cache', mountPath: '/mnt/mounted' }] }).catch((e) => e);
    expect(err.message).toMatch(/no filesystem/);
    // The SDK retries volume errors that say attached/mounted; this one must not.
    expect(err.message).not.toMatch(/attached|mounted/);
    expect(fork).not.toHaveBeenCalled();
  });

  it('rejects a deleted volume handle before forking or mounting', async () => {
    const { vm, fork } = mockVm();
    const provider = arker(config);
    const sandbox = await provider.instances.create();
    const volume = await provider.volume!.get(FS_ID);
    expect(volume).toMatchObject({ id: FS_ID });
    vi.mocked(Arker.prototype.getFilesystem).mockRejectedValue(new ArkerError('not_found', 'no such filesystem', 404));
    // A different live volume can have a name that looks like the deleted ID.
    const list = vi.spyOn(Arker.prototype, 'listFilesystems').mockResolvedValue({
      filesystems: [filesystem(FS_ID, 'dir_aaaaaaaaaaaaaaaaaaaaaa')],
      next_cursor: null,
    });
    fork.mockClear();

    await expect(sandbox.attachVolume!(volume!, '/mnt/data')).rejects.toThrow(/no filesystem/);
    await expect(provider.instances.create({ volumes: [{ volume: volume!, mountPath: '/mnt/data' }] }))
      .rejects.toThrow(/no filesystem/);
    expect(list).not.toHaveBeenCalled();
    expect(fork).not.toHaveBeenCalled();
    expect(vm.createMount).not.toHaveBeenCalled();
  });

  it('refuses a read-only mount before forking, naming the entry rather than its path', async () => {
    const { fork } = mockVm();
    const err = await arker(config).instances.create({
      volumes: [{ volume: FS_ID, mountPath: '/mnt/rw' }, { volume: FS_ID, mountPath: '/mnt/mounted', readOnly: true }],
    }).catch((e) => e);
    expect(err.message).toMatch(/volumes\[1\] read-only/);
    // ComputeSDK retries a create whose error says `mounted`; a path must not make it.
    expect(err.message).not.toMatch(/attached|mounted|busy/);
    expect(fork).not.toHaveBeenCalled();
  });

  it('refuses volumes that are not { volume, mountPath } entries', async () => {
    const { fork } = mockVm();
    await expect(arker(config).instances.create({ volumes: [{ mountPath: '/mnt/data' }] as never }))
      .rejects.toThrow(/needs a `volume` and, as `mountPath`, an absolute mount path/);
    expect(fork).not.toHaveBeenCalled();
  });

  it('finds a volume by name whatever its case, though the prefix filter matches case', async () => {
    const list = vi.spyOn(Arker.prototype, 'listFilesystems').mockImplementation(async (opts) => ({
      filesystems: [filesystem('Data')].filter((fs) => !opts?.namePrefix || fs.name.startsWith(opts.namePrefix)),
      next_cursor: null,
    }));
    expect(await arker(config).volume!.get('data')).toMatchObject({ id: FS_ID, name: 'Data' });
    expect(list.mock.calls).toEqual([[{ namePrefix: 'data' }], [{}]]);
    list.mockClear();
    expect(await arker(config).volume!.get('Data')).toMatchObject({ id: FS_ID });
    expect(list).toHaveBeenCalledTimes(1);
  });

  it('looks for the mount point as /proc/mounts writes it, and detaches it by any spelling', async () => {
    const { vm, mounts } = mockVm();
    const sandbox = await arker(config).instances.create();
    await sandbox.attachVolume!({ id: FS_ID }, '//mnt/./data/');
    expect(vm.createMount).toHaveBeenCalledWith({ filesystemId: FS_ID, path: '/mnt/data' });
    expect(vm.run.mock.calls[0][0]).toContain(`grep -qsF ' /mnt/data ' /proc/mounts`);
    await sandbox.detachVolume!({ id: FS_ID }, '/mnt//data/');
    expect(mounts).toEqual([]);
  });

  it('attaches again at a mount point the sandbox has under another spelling', async () => {
    const { vm, mounts } = mockVm();
    const sandbox = await arker(config).instances.create();
    // As a restore copies its source's mount, spelled as the source's caller did.
    mounts.push({ mount_id: 'mnt-copied', vm_id: 'vm-new', filesystem_id: FS_ID, path: '/mnt/data/', state: 'mounted' } as Mount);
    await sandbox.attachVolume!({ id: FS_ID }, '/mnt/data/');
    await sandbox.attachVolume!({ id: FS_ID }, '/mnt/data');
    expect(vm.createMount.mock.calls.map(([r]) => r.path)).toEqual(['/mnt/data/', '/mnt/data/']);
    expect(mounts.map((m) => m.mount_id)).toEqual(['mnt-copied']);
  });

  it('retries a failed mount the sandbox had, reading past its old failed state', async () => {
    const { vm, mounts } = mockVm({ pollsUntilMounted: 1 });
    const sandbox = await arker(config).instances.create();
    mounts.push({ mount_id: 'mnt-copied', vm_id: 'vm-new', filesystem_id: FS_ID, path: '/mnt/data/', state: 'failed' } as Mount);
    // The first poll still shows the old `failed`; the next shows the retry mounted.
    await sandbox.attachVolume!({ id: FS_ID }, '/mnt/data');
    expect(vm.createMount).toHaveBeenCalledWith({ filesystemId: FS_ID, path: '/mnt/data/' });
    expect(mounts.map((m) => [m.mount_id, m.state])).toEqual([['mnt-copied', 'mounted']]);
    expect(vm.deleteMount).not.toHaveBeenCalled();
  });

  it('refuses mount paths Arker cannot mount, without quoting them', async () => {
    const { vm, fork } = mockVm();
    const sandbox = await arker(config).instances.create();
    for (const path of ['data/mounted', '/mnt/my mounted data', '/mnt/a\\b', '//', '/mnt/../busy', '/data/v1..2', `/mnt/${'x'.repeat(256)}`]) {
      const err = await sandbox.attachVolume!({ id: FS_ID }, path).catch((e) => e);
      expect(err.message).toMatch(/without whitespace, backslashes or `\.\.`/);
      expect(err.message).not.toContain(path);
      // ComputeSDK retries an attach whose error says `mounted` or `busy`; a path must not make it.
      expect(err.message).not.toMatch(/mounted|busy/);
    }
    await expect(arker(config).instances.create({ volumes: [{ volume: FS_ID, mountPath: '/mnt/a b' }] })).rejects.toThrow(/without whitespace/);
    expect(vm.createMount).not.toHaveBeenCalled();
    expect(fork).toHaveBeenCalledTimes(1);
  });

  it('keeps a mount the sandbox already had when attaching it again fails', async () => {
    const { vm, mounts } = mockVm();
    const sandbox = await arker(config).instances.create();
    await sandbox.attachVolume!({ id: FS_ID }, '/mnt/data');
    vm.run.mockRejectedValueOnce(new ArkerError('unavailable', 'try again', 503));
    await expect(sandbox.attachVolume!({ id: FS_ID }, '/mnt/data')).rejects.toMatchObject({ status: 503 });
    expect(mounts.map((m) => [m.path, m.state])).toEqual([['/mnt/data', 'mounted']]);
    expect(vm.deleteMount).not.toHaveBeenCalled();
  });

  it('removes a mount that failed, so a later attach starts afresh', async () => {
    const { vm, mounts } = mockVm({ fail: true });
    const sandbox = await arker(config).instances.create();
    await expect(sandbox.attachVolume!({ id: FS_ID }, '/mnt/data')).rejects.toThrow(/could not mount/);
    expect(vm.deleteMount).toHaveBeenCalledWith('mnt-1');
    expect(mounts).toEqual([]);
  });

  it('deletes the new VM when a create-time mount fails', async () => {
    const { vm } = mockVm({ fail: true });
    await expect(arker(config).instances.create({ volumes: [{ volume: { id: FS_ID }, mountPath: '/mnt/data' }] }))
      .rejects.toThrow(/could not mount/);
    expect(vm.delete).toHaveBeenCalledTimes(1);
  });

  it('attaches, detaches and reattaches at runtime', async () => {
    const { vm, mounts } = mockVm();
    const sandbox = await arker(config).instances.create();
    await sandbox.attachVolume!({ id: FS_ID }, '/mnt/a');
    expect(mounts.map((m) => [m.path, m.state])).toEqual([['/mnt/a', 'mounted']]);
    await expect(sandbox.detachVolume!({ id: FS_ID }, '/mnt/b')).rejects.toThrow(/no such mount/);
    await sandbox.detachVolume!({ id: FS_ID }, '/mnt/a/');
    expect(mounts).toEqual([]);
    await sandbox.attachVolume!({ id: FS_ID }, '/mnt/b');
    await sandbox.detachVolume!({ id: FS_ID });
    expect(mounts).toEqual([]);
    expect(vm.deleteMount).toHaveBeenCalledTimes(2);
  });
});
