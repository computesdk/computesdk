/**
 * Sail standard-size mapping (mock-only; no Sailbox is created).
 *
 * Sail takes per-create `vcpuCount` (1-64, power of two) and `memoryLimitGib`
 * (16-256 GiB, power of two; anything smaller is raised to 16 GiB). CPU and
 * memory are independent. Sources: docs.sailresearch.com/sailboxes-create,
 * /sailboxes-pricing, /sailbox-sdk and @sailresearch/sdk 0.18.2 types.
 *
 * Ways the mapping could fail, each covered below:
 * - Wrong shape: a class maps to the wrong vCPU count or memory limit, or to
 *   a shape below the profile (e.g. 1 vCPU for md, or 8 GiB, which Sail would
 *   silently raise to 16 GiB).
 * - Mis-declared shape: `resolved` hides the 16 GiB memory floor and reports
 *   the profile instead of what Sail actually configures.
 * - xs accepted: every Sail shape has at least 16 GiB, so the smallest one
 *   (1 vCPU / 16 GiB) is sm; xs must be refused, not booted as sm.
 * - Silent default boot: the resolved fields never reach `Sailbox.create`, so
 *   the box boots with the image defaults (8 vCPU / 64 GiB).
 * - Dropped field: only one of vcpuCount / memoryLimitGib is forwarded.
 * - Deprecated `size` sent beside vcpuCount (the SDK rejects both together).
 * - Conflict accepted: sizeClass combined with native vcpuCount, memoryGib,
 *   memoryLimitGib or size is silently overridden instead of rejected.
 * - Checkpoint restore: `snapshotId` keeps the checkpoint's resources and the
 *   restore call has no resource fields, so sizeClass must be refused there.
 * - Native vcpuCount without sizeClass is dropped by the create path.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  createArgs: [] as Array<Record<string, unknown>>,
  restoreArgs: [] as Array<Record<string, unknown>>,
}));

vi.mock('@sailresearch/sdk', () => {
  const box = (id: string) => ({ sailboxId: id, status: 'running', createdAt: new Date(0), client: {} });
  return {
    Image: {
      devbox: vi.fn(() => ({ base: 'devbox' })),
      fromRegistry: vi.fn((ref: string) => ({ base: ref })),
    },
    NotFoundError: class NotFoundError extends Error {},
    resolveConfig: vi.fn(() => ({
      mode: undefined,
      apiKey: 'env-key',
      apiUrl: 'https://api.example',
      sailboxApiUrl: 'https://sailbox.example',
      imagebuilderUrl: 'https://images.example',
      ingressScheme: 'subdomain',
      ingressBase: 'sail.example',
    })),
    Client: {
      fromConfig: vi.fn(() => ({ terminateSailbox: vi.fn(async () => undefined) })),
      fromEnv: vi.fn(() => ({ terminateSailbox: vi.fn(async () => undefined) })),
    },
    App: { find: vi.fn(async () => ({ id: 'app-1', name: 'computesdk' })) },
    Sailbox: {
      create: vi.fn(async (request: Record<string, unknown>) => {
        h.createArgs.push(request);
        return box('sb-new');
      }),
      fromCheckpoint: vi.fn(async (request: Record<string, unknown>) => {
        h.restoreArgs.push(request);
        return box('sb-restored');
      }),
    },
  };
});

import { sail, SAIL_SIZE_SHAPES } from '../index';

const provider = () => sail({ apiKey: 'sail-key' });

const mapped = [
  ['sm', 1, 2048, 1, 16],
  ['md', 2, 4096, 2, 16],
  ['lg', 4, 8192, 4, 16],
  ['xl', 8, 16384, 8, 16],
  ['2xl', 16, 32768, 16, 32],
  ['3xl', 32, 131072, 32, 128],
] as const;

describe('Sail standard size mapping (mock-only)', () => {
  beforeEach(() => {
    h.createArgs.length = 0;
    h.restoreArgs.length = 0;
  });

  it('supports sm-3xl and refuses xs as unsupported', () => {
    const sizes = provider().sizes;
    expect(sizes.list().filter((r) => r.status === 'supported').map((r) => r.requested.sizeClass))
      .toEqual(['sm', 'md', 'lg', 'xl', '2xl', '3xl']);
    const xs = sizes.resolve('xs');
    expect(xs).toMatchObject({ status: 'unsupported' });
    expect(xs.status !== 'supported' && xs.reason).toMatch(/16 GiB/);
  });

  it.each(mapped)('%s resolves to %i vCPU / %i MiB as vcpuCount %i + %i GiB memory', (sizeClass, vcpus, memoryMiB, vcpuCount, memoryGib) => {
    const resolution = provider().sizes.resolve(sizeClass);
    expect(resolution).toMatchObject({
      status: 'supported',
      requested: { sizeClass, vcpus, memoryMiB },
      resolved: { vcpus: vcpuCount, memoryMiB: memoryGib * 1024 },
      nativeOptions: { vcpuCount, memoryGib },
      provenance: 'adapter-declared',
    });
    expect(resolution.status === 'supported' && resolution.resolved).not.toHaveProperty('diskMiB');
    expect(resolution).not.toHaveProperty('belowStandard');
    // Values Sail would not round: powers of two inside the documented ranges.
    for (const value of [vcpuCount, memoryGib]) expect(Math.log2(value) % 1).toBe(0);
    expect(memoryGib).toBeGreaterThanOrEqual(16);
    expect(SAIL_SIZE_SHAPES[sizeClass]).toEqual({ vcpuCount, memoryGib });
  });

  it.each(mapped)('create({ sizeClass: %s }) forwards vcpuCount and memoryLimitGib to Sailbox.create', async (sizeClass, _v, _m, vcpuCount, memoryGib) => {
    const sandbox = await provider().instances.create({ sizeClass });
    expect(h.createArgs).toHaveLength(1);
    expect(h.createArgs[0]).toMatchObject({ vcpuCount, memoryLimitGib: memoryGib });
    expect(h.createArgs[0]).not.toHaveProperty('size');
    expect(h.createArgs[0]).not.toHaveProperty('sizeClass');
    expect(h.createArgs[0]).not.toHaveProperty('memoryGib');
    expect(sandbox.sizing).toMatchObject({ requested: { sizeClass }, resolved: { vcpus: vcpuCount, memoryMiB: memoryGib * 1024 } });
  });

  it('keeps the sized fields alongside a per-create image', async () => {
    await provider().instances.create({ sizeClass: 'lg', image: 'node:22' });
    expect(h.createArgs[0]).toMatchObject({ image: { base: 'node:22' }, vcpuCount: 4, memoryLimitGib: 16 });
  });

  it.each([
    { sizeClass: 'xs' },
    { sizeClass: 'md', vcpuCount: 2 },
    { sizeClass: 'md', memoryGib: 16 },
    { sizeClass: 'md', memoryLimitGib: 16 },
    { sizeClass: 'md', size: 'm' },
    { sizeClass: 'md', snapshotId: 'ckpt-1' },
  ])('rejects without creating: %j', async (options) => {
    await expect(provider().instances.create(options as any)).rejects.toMatchObject({ name: 'InstanceSizeError', fallback: false });
    expect(h.createArgs).toHaveLength(0);
    expect(h.restoreArgs).toHaveLength(0);
  });

  it('reports native CPU/memory selectors as conflicts', () => {
    for (const field of ['vcpuCount', 'memoryGib', 'memoryLimitGib']) {
      expect(() => provider().sizes.resolve('md', { [field]: 2 } as any)).toThrow(expect.objectContaining({ code: 'conflict' }));
    }
  });

  it('forwards a native vcpuCount without sizeClass and refuses it beside size or snapshotId', async () => {
    await provider().instances.create({ vcpuCount: 16, memoryGib: 32 } as any);
    expect(h.createArgs[0]).toMatchObject({ vcpuCount: 16, memoryLimitGib: 32 });
    await expect(provider().instances.create({ vcpuCount: 4, size: 'm' } as any)).rejects.toThrow(/vcpuCount/);
    await expect(provider().instances.create({ vcpuCount: 4, snapshotId: 'ckpt-1' } as any)).rejects.toThrow(/snapshotId/);
    expect(h.createArgs).toHaveLength(1);
    expect(h.restoreArgs).toHaveLength(0);
  });
});
