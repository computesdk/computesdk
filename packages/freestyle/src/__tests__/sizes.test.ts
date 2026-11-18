import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Ways the Freestyle mapping could fail:
// - wrong shape: a class resolves to a size other than its profile, or xs/sm
//   claim a shape Freestyle does not list (resize is grow-only; the smallest
//   Ubuntu snapshot is 2 vCPU / 4 GiB).
// - silent default boot: md boots the 4/8 GiB runtime snapshot instead of
//   freestyle/ubuntu-sm, or a larger-than-requested snapshot is kept.
// - dropped field: cpu/memory never reach `vm.resize`, or the snapshot-bake
//   fallback boots without growing.
// - conflict accepted: sizeClass combined with native cpu/memory, or with a
//   caller-chosen sandbox/snapshot/template (config or env) that fixes the size.
const RUNTIME_SLUG = 'computesdk-freestyle-runtime-v2';
const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  delete: vi.fn(),
  list: vi.fn(),
  data: vi.fn(),
  resize: vi.fn(),
  exec: vi.fn(),
}));

vi.mock('freestyle', () => ({
  FreestyleApiError: class extends Error {
    constructor(message: string, readonly code: string) { super(message); }
  },
  Freestyle: class {
    vms = { create: mocks.create, delete: mocks.delete, snapshots: { list: mocks.list } };
  },
}));

import { FreestyleApiError } from 'freestyle';
import { freestyle } from '../index';

const grown = [['xl', 8, 16384], ['2xl', 16, 32768], ['3xl', 32, 131072]] as const;

function bootsAt(cpu: number, memory: number) {
  mocks.data.mockResolvedValue({ resources: { cpu, memory } });
}

describe('Freestyle standard sizes (mock-only)', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv('FREESTYLE_SNAPSHOT_ID', '');
    vi.stubEnv('FREESTYLE_API_URL', '');
    mocks.create.mockResolvedValue({ vmId: 'vm-test', vm: { data: mocks.data, resize: mocks.resize, exec: mocks.exec } });
    mocks.delete.mockResolvedValue(undefined);
    bootsAt(4, 8192);
    mocks.resize.mockImplementation(async (patch: { cpu?: number; memory?: number }) => ({
      resources: { cpu: patch.cpu ?? 4, memory: patch.memory ?? 8192 },
    }));
  });

  afterEach(() => { vi.unstubAllEnvs(); });

  it('lists md through 3xl at their exact profiles and refuses xs/sm', () => {
    const list = freestyle({ apiKey: 'k' }).sizes.list();
    expect(list.map(r => [r.requested.sizeClass, r.status])).toEqual([
      ['xs', 'unsupported'], ['sm', 'unsupported'], ['md', 'supported'], ['lg', 'supported'],
      ['xl', 'supported'], ['2xl', 'supported'], ['3xl', 'supported'],
    ]);
    for (const r of list) {
      if (r.status === 'supported') {
        expect(r.resolved).toMatchObject({ vcpus: r.requested.vcpus, memoryMiB: r.requested.memoryMiB });
        expect(r).not.toHaveProperty('belowStandard');
      } else {
        expect(r.reason).toMatch(/grow-only/);
      }
    }
  });

  it('md boots freestyle/ubuntu-sm without resizing', async () => {
    bootsAt(2, 4096);
    const sandbox = await freestyle({ apiKey: 'k' }).instances.create({ sizeClass: 'md' });
    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({ snapshotId: 'freestyle/ubuntu-sm' }));
    expect(mocks.resize).not.toHaveBeenCalled();
    expect(sandbox.sizing).toMatchObject({
      requested: { sizeClass: 'md' }, resolved: { vcpus: 2, memoryMiB: 4096, diskMiB: 16000 }, provenance: 'adapter-declared',
    });
  });

  it('md refuses and deletes a base snapshot that boots larger than 2 vCPU / 4 GiB', async () => {
    bootsAt(4, 8192);
    await expect(freestyle({ apiKey: 'k' }).instances.create({ sizeClass: 'md' })).rejects.toThrow(/grow-only/);
    expect(mocks.delete).toHaveBeenCalledWith('vm-test');
  });

  it('lg boots the runtime snapshot as-is', async () => {
    const sandbox = await freestyle({ apiKey: 'k' }).instances.create({ sizeClass: 'lg' });
    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({ snapshotId: RUNTIME_SLUG }));
    expect(mocks.resize).not.toHaveBeenCalled();
    expect(sandbox.sizing?.resolved).toEqual({ vcpus: 4, memoryMiB: 8192, diskMiB: 32000 });
  });

  it.each(grown)('%s grows the runtime snapshot to %i vCPU / %i MiB', async (sizeClass, cpu, memory) => {
    mocks.exec.mockResolvedValue({ statusCode: 0, stdout: `${cpu}\n${memory * 1024}\n` });
    const sandbox = await freestyle({ apiKey: 'k' }).instances.create({ sizeClass });
    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({ snapshotId: RUNTIME_SLUG }));
    expect(mocks.resize).toHaveBeenCalledWith({ cpu, memory });
    expect(sandbox.sizing?.resolved).toEqual({ vcpus: cpu, memoryMiB: memory, diskMiB: 32000 });
  });

  it('still grows when the runtime snapshot has to be resolved by the bake fallback', async () => {
    mocks.create
      .mockRejectedValueOnce(new (FreestyleApiError as any)(`snapshot ${RUNTIME_SLUG} not found`, 'NOT_FOUND'))
      .mockResolvedValueOnce({ vmId: 'vm-test', vm: { data: mocks.data, resize: mocks.resize, exec: mocks.exec } });
    mocks.list.mockResolvedValue({ snapshots: [{ id: 'sh-runtime', slug: RUNTIME_SLUG }], totalCount: 1 });
    mocks.exec.mockResolvedValue({ statusCode: 0, stdout: `16\n${32768 * 1024}\n` });
    await freestyle({ apiKey: 'k' }).instances.create({ sizeClass: '2xl' });
    expect(mocks.create).toHaveBeenLastCalledWith(expect.objectContaining({ snapshotId: 'sh-runtime' }));
    expect(mocks.resize).toHaveBeenCalledWith({ cpu: 16, memory: 32768 });
  });

  it.each([
    [{ sizeClass: 'lg', cpu: 4 }, 'conflict'],
    [{ sizeClass: 'lg', memory: 8192 }, 'conflict'],
    [{ sizeClass: 'lg', snapshotId: 'sh-mine' }, 'unsupported'],
    [{ sizeClass: 'md', templateId: 'freestyle/ubuntu' }, 'unsupported'],
    [{ sizeClass: 'xl', sandboxId: 'vm-old' }, 'unsupported'],
    [{ sizeClass: 'xs' }, 'unsupported'],
    [{ sizeClass: 'sm' }, 'unsupported'],
  ] as const)('rejects without creating: %j', async (options, code) => {
    await expect(freestyle({ apiKey: 'k' }).instances.create(options as any))
      .rejects.toMatchObject({ name: 'InstanceSizeError', code, fallback: false });
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('rejects a configured snapshot without creating', async () => {
    await expect(freestyle({ apiKey: 'k', snapshotId: 'sh-mine' }).instances.create({ sizeClass: '2xl' }))
      .rejects.toMatchObject({ code: 'unsupported' });
    expect(mocks.create).not.toHaveBeenCalled();
  });
});
