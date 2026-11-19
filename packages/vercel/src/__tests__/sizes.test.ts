/**
 * Vercel standard-size mapping (mock-only; no sandboxes booted).
 *
 * Vercel sizes a sandbox by `resources.vcpus` only (1 or an even number 2-32,
 * 2048 MB RAM per vCPU; Enterprise max 32 vCPU / 64 GB) with a fixed 64 GB
 * disk (32 GB for deprecated `runtime` sandboxes).
 *
 * Ways the mapping could fail, each covered below:
 * - Wrong shape: a class maps to the wrong vCPU count (memory follows vCPUs,
 *   so a wrong count is also wrong RAM). xs is 1 vCPU / 2048 MiB: vCPU picks
 *   the class and the extra RAM is recorded in resolved.
 * - Dropped field: `resources.vcpus` is lost on the plain, snapshot, template
 *   or `source` create branches, or sizeClass leaks to the vendor call.
 * - Wrong disk: resolved.diskMiB not 64 GiB, or not 32 GiB for `runtime`.
 * - Conflict accepted: native `resources` (or `vcpus`/`memory`) combined
 *   with sizeClass boots instead of throwing InstanceSizeError('conflict').
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { vercel } from '../index';

const { create } = vi.hoisted(() => ({
  create: vi.fn(async (..._args: unknown[]) => ({ name: 'sbx-1' })),
}));
vi.mock('@vercel/sandbox', () => ({
  Sandbox: { create: (...args: unknown[]) => create(...args) },
  Snapshot: {},
  Drive: {},
}));

const config = { token: 'tok', teamId: 'team', projectId: 'proj' };
const supported = [['xs', 1, 2048], ['sm', 1, 2048], ['md', 2, 4096], ['lg', 4, 8192], ['xl', 8, 16384], ['2xl', 16, 32768], ['3xl', 32, 65536]] as const;

describe('Vercel standard sizes (mock-only)', () => {
  beforeEach(() => { create.mockClear(); });

  it('lists every class as supported (xs on the 1 vCPU / 2048 MiB shape, 3xl at the 32 vCPU maximum)', () => {
    const list = vercel(config).sizes.list();
    expect(list.map(r => [r.requested.sizeClass, r.status])).toEqual([
      ['xs', 'supported'], ['sm', 'supported'], ['md', 'supported'], ['lg', 'supported'],
      ['xl', 'supported'], ['2xl', 'supported'], ['3xl', 'supported'],
    ]);
  });

  it.each(supported)('resolves %s to exactly %i vCPU / %i MiB with a 64 GiB disk', (sizeClass, vcpus, memoryMiB) => {
    const resolution = vercel(config).sizes.resolve(sizeClass);
    expect(resolution).toMatchObject({
      status: 'supported', nativeOptions: { resources: { vcpus } },
      resolved: { vcpus, memoryMiB, diskMiB: 65536 }, provenance: 'adapter-declared',
    });
    expect(resolution).not.toHaveProperty('belowStandard');
  });

  it.each(supported)('boots %s with resources.vcpus=%i', async (sizeClass, vcpus, memoryMiB) => {
    const sandbox = await vercel(config).instances.create({ sizeClass });
    expect(create).toHaveBeenCalledTimes(1);
    const params = create.mock.calls[0]![0] as Record<string, unknown>;
    expect(params.resources).toEqual({ vcpus });
    expect(params).not.toHaveProperty('sizeClass');
    expect(sandbox.sizing).toMatchObject({ requested: { sizeClass }, resolved: { vcpus, memoryMiB, diskMiB: 65536 } });
  });

  it('reports the 32 GiB runtime disk when a deprecated runtime is selected', async () => {
    const sandbox = await vercel(config).instances.create({ sizeClass: 'md', runtime: 'node' } as any);
    expect(create.mock.calls[0]![0]).toMatchObject({ resources: { vcpus: 2 }, runtime: 'node24' });
    expect(sandbox.sizing?.resolved).toEqual({ vcpus: 2, memoryMiB: 4096, diskMiB: 32768 });
  });

  it.each([
    [{ snapshotId: 'snap-1' }, { type: 'snapshot', snapshotId: 'snap-1' }],
    [{ templateId: 'snap-2' }, { type: 'snapshot', snapshotId: 'snap-2' }],
    [{ source: { type: 'git', url: 'https://example.com/r.git' } }, { type: 'git', url: 'https://example.com/r.git' }],
  ])('forwards resources on the %j branch', async (extra, source) => {
    await vercel(config).instances.create({ sizeClass: 'lg', ...extra } as any);
    expect(create.mock.calls[0]![0]).toMatchObject({ resources: { vcpus: 4 }, source });
  });

  it.each([
    { sizeClass: 'md', resources: { vcpus: 4 } },
    { sizeClass: 'md', vcpus: 4 },
    { sizeClass: 'md', memory: 8192 },
  ])('rejects conflicting native sizing without creating: %j', async (options) => {
    await expect(vercel(config).instances.create(options as any))
      .rejects.toMatchObject({ name: 'InstanceSizeError', code: 'conflict', fallback: false });
    expect(create).not.toHaveBeenCalled();
  });

  it('leaves unsized creates on the vendor default', async () => {
    await vercel(config).instances.create();
    expect(create.mock.calls[0]![0]).not.toHaveProperty('resources');
  });
});
