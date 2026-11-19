/**
 * Lightning standard-size mapping (mock-only; no API key, no live sandboxes).
 *
 * Ways the mapping could fail, each covered below:
 * - Wrong shape: a size picks a type below its profile (cpu-1 for sm), a bigger type than the
 *   smallest that belongs to it, or declares the wrong vCPU/RAM/disk in `resolved`.
 * - Silent default boot: the create call reaches the SDK without the mapped instanceType, so the
 *   adapter's `cpu-1` default (or `config.instanceType`) boots instead.
 * - Dropped field: instanceType lost on the snapshotId/templateId restore path, or a storageGb
 *   override not reflected in `resolved.diskMiB`.
 * - Conflict accepted: sizeClass together with a native instanceType (or a generic cpu/memory
 *   field) boots something instead of rejecting before any SDK call.
 * - Unsupported size boots: sm and 3xl (no listed Lightning type) reach the SDK instead of
 *   rejecting as 'unsupported'.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

const { create } = vi.hoisted(() => ({
  create: vi.fn(async (params: Record<string, unknown>) => ({
    sandboxId: 'sb-1', name: 'n', status: 'running', ports: [], portUrls: {},
    instanceType: params.instanceType, runtime: 'node24', timeout: 0, createdAt: new Date(),
  })),
}));

vi.mock('@lightningai/sdk', () => ({
  Sandbox: {
    configure: () => {},
    create: (params: Record<string, unknown>) => create(params),
    get: async () => { throw new Error('not used'); },
    list: async () => ({ sandboxes: [] }),
  },
}));

import { lightning, LIGHTNING_SIZE_INSTANCE_TYPES } from '../index';

const supported = [
  ['xs', 1, 1024, 'cpu-1', 1, 1024, undefined],
  ['md', 2, 4096, 'cpu-2', 2, 8192, 10240],
  ['lg', 4, 8192, 'cpu-4', 4, 16384, 40960],
  ['xl', 8, 16384, 'cpu-8', 8, 32768, 61440],
  ['2xl', 16, 32768, 'cpu-16', 16, 65536, 81920],
] as const;

const provider = (config: Record<string, unknown> = {}) => lightning({ apiKey: 'lt-test', ...config });

describe('Lightning standard size mapping (mock-only)', () => {
  afterEach(() => { create.mockClear(); });

  it('lists xs, md, lg, xl, 2xl as supported and sm/3xl as unsupported', () => {
    const list = provider().sizes.list();
    expect(list.filter(r => r.status === 'supported').map(r => r.requested.sizeClass)).toEqual(['xs', 'md', 'lg', 'xl', '2xl']);
    for (const sizeClass of ['sm', '3xl'] as const) {
      const r = provider().sizes.resolve(sizeClass);
      expect(r.status).toBe('unsupported');
      expect(r).toHaveProperty('reason', expect.stringMatching(/Lightning/));
    }
  });

  it.each(supported)('%s resolves to %s with its listed shape', (sizeClass, vcpus, memoryMiB, instanceType, rv, rm, disk) => {
    const r = provider().sizes.resolve(sizeClass);
    expect(r).toMatchObject({ status: 'supported', requested: { sizeClass, vcpus, memoryMiB }, nativeOptions: { instanceType } });
    if (r.status !== 'supported') throw new Error('unreachable');
    expect(r.resolved).toEqual({ vcpus: rv, memoryMiB: rm, ...(disk === undefined ? {} : { diskMiB: disk }) });
    expect(r.resolved.vcpus).toBeGreaterThanOrEqual(vcpus);
    expect(r.resolved.memoryMiB).toBeGreaterThanOrEqual(memoryMiB);
    expect(r.belowStandard).toBeUndefined();
    expect(LIGHTNING_SIZE_INSTANCE_TYPES[sizeClass]?.instanceType).toBe(instanceType);
  });

  it.each(supported)('create %s forwards instanceType %s to Sandbox.create', async (sizeClass, _v, _m, instanceType, rv, rm) => {
    const result = await provider().instances.create({ sizeClass });
    expect(create).toHaveBeenCalledTimes(1);
    const params = create.mock.calls[0][0];
    expect(params.instanceType).toBe(instanceType);
    expect(params).not.toHaveProperty('sizeClass');
    expect(result.sizing).toMatchObject({ requested: { sizeClass }, resolved: { vcpus: rv, memoryMiB: rm }, provenance: 'adapter-declared' });
  });

  it('overrides config.instanceType with the mapped type', async () => {
    await provider({ instanceType: 'cpu-16' }).instances.create({ sizeClass: 'md' });
    expect(create.mock.calls[0][0].instanceType).toBe('cpu-2');
  });

  it('keeps instanceType on the snapshot/template restore path', async () => {
    await provider().instances.create({ sizeClass: 'lg', snapshotId: 'snap-1' });
    expect(create.mock.calls[0][0]).toMatchObject({ instanceType: 'cpu-4', snapshotId: 'snap-1' });
    await provider().instances.create({ sizeClass: 'xl', templateId: 'snap-2' });
    expect(create.mock.calls[1][0]).toMatchObject({ instanceType: 'cpu-8', snapshotId: 'snap-2' });
  });

  it('forwards a storageGb override and reports it as resolved.diskMiB', async () => {
    const result = await provider().instances.create({ sizeClass: 'md', storageGb: 20 } as never);
    expect(create.mock.calls[0][0]).toMatchObject({ instanceType: 'cpu-2', storageGb: 20 });
    expect(result.sizing?.resolved).toEqual({ vcpus: 2, memoryMiB: 8192, diskMiB: 20480 });
    expect(provider().sizes.resolve('md', { storageGb: 0 } as never)).toMatchObject({ resolved: { diskMiB: 10240 } });
  });

  it('still uses instanceType per create without sizeClass, and the config default otherwise', async () => {
    await provider({ instanceType: 'cpu-4' }).instances.create({ instanceType: 'cpu-8' } as never);
    expect(create.mock.calls[0][0].instanceType).toBe('cpu-8');
    await provider({ instanceType: 'cpu-4' }).instances.create();
    expect(create.mock.calls[1][0].instanceType).toBe('cpu-4');
    await provider().instances.create();
    expect(create.mock.calls[2][0].instanceType).toBe('cpu-1');
  });

  it.each([
    [{ sizeClass: 'md', instanceType: 'cpu-2' }, 'conflict'],
    [{ sizeClass: 'md', instanceType: 'gpu.small' }, 'conflict'],
    [{ sizeClass: 'md', cpus: 2 }, 'conflict'],
    [{ sizeClass: 'md', memoryMiB: 4096 }, 'conflict'],
    [{ sizeClass: 'md', storageGb: 1.5 }, 'invalid'],
    [{ sizeClass: 'md', storageGb: '10' }, 'invalid'],
    [{ sizeClass: 'sm' }, 'unsupported'],
    [{ sizeClass: '3xl' }, 'unsupported'],
    [{ sizeClass: '4xl' }, 'invalid'],
  ])('rejects without creating: %j', async (options, code) => {
    await expect(provider().instances.create(options as never)).rejects.toMatchObject({ name: 'InstanceSizeError', code, fallback: false });
    expect(create).not.toHaveBeenCalled();
  });
});
