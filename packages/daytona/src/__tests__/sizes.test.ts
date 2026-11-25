import { beforeEach, describe, expect, it, vi } from 'vitest';

// Ways the Daytona sizeClass mapping can fail:
// - wrong shape: a class sends CPU/RAM/disk other than its profile, or in the
//   wrong unit (Daytona takes vCPU and GiB, not MiB);
// - snapshot source wins: a v2 snapshot (memory + disk) fixes the size, so a
//   sized create from one must be refused;
// - dropped field: the create path drops `resources` or `image`, or flattens
//   them where the SDK does not read them;
// - wrong refusal: a class above Daytona's 4 vCPU / 8 GiB sandbox limit is
//   accepted, or a class Daytona offers is refused;
// - conflict accepted: sizeClass combined with native cpu/memory/resources.
const mocks = vi.hoisted(() => ({ create: vi.fn(), createFromSnapshot: vi.fn() }));

vi.mock('@daytona/sdk', () => ({
  Daytona: class {
    v2 = { create: mocks.create, createFromSnapshot: mocks.createFromSnapshot };
  },
}));

vi.mock('@daytona/sdk/v2', () => ({
  NotFoundError: class extends Error {},
  Sandbox: class {},
}));

import { daytona } from '../index';

const GiB = 1024;
const provider = () => daytona({ apiKey: 'test-key' });

describe('daytona sizeClass', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.create.mockResolvedValue({ id: 'sb-test' });
  });

  it.each([
    ['xs', { cpu: 1, memory: 1 }, { vcpus: 1, memoryMiB: GiB }],
    ['sm', { cpu: 1, memory: 2, disk: 10 }, { vcpus: 1, memoryMiB: 2 * GiB, diskMiB: 10 * GiB }],
    ['md', { cpu: 2, memory: 4, disk: 20 }, { vcpus: 2, memoryMiB: 4 * GiB, diskMiB: 20 * GiB }],
    ['lg', { cpu: 4, memory: 8, disk: 40 }, { vcpus: 4, memoryMiB: 8 * GiB, diskMiB: 40 * GiB }],
  ] as const)('maps %s to exact resources on an image create', async (sizeClass, resources, resolved) => {
    const p = provider();
    const support = p.sizes.resolve(sizeClass);
    expect(support.status).toBe('supported');
    if (support.status !== 'supported') return;
    expect(support.nativeOptions).toEqual({ resources });
    expect(support.resolved).toEqual(resolved);

    const result = await p.instances.create({ sizeClass });
    expect(result.sizing).toMatchObject({ requested: { sizeClass }, resolved });
    expect(mocks.create).toHaveBeenCalledTimes(1);
    const [image, params] = mocks.create.mock.calls[0];
    expect(image).toBeUndefined();
    expect(params.resources).toEqual(resources);
    expect(params.image).toBeUndefined();
    expect(params.snapshot).toBeUndefined();
    expect(params.sizeClass).toBeUndefined();
  });

  it('keeps a caller image, a template image and the sizeImage override', async () => {
    await provider().instances.create({ sizeClass: 'md', image: 'python:3.12' } as any);
    expect(mocks.create.mock.calls[0][0]).toBe('python:3.12');
    expect(mocks.create.mock.calls[0][1]).toMatchObject({ resources: { cpu: 2, memory: 4, disk: 20 } });

    await daytona({ apiKey: 'test-key', sizeImage: 'ubuntu:24.04' }).instances.create({ sizeClass: 'sm' });
    expect(mocks.create.mock.calls[1][0]).toBe('ubuntu:24.04');
    expect(mocks.create.mock.calls[1][1]).toMatchObject({ resources: { cpu: 1, memory: 2, disk: 10 } });

    await provider().instances.create({ sizeClass: 'md', templateId: 'img-a' });
    expect(mocks.create.mock.calls[2][0]).toBe('img-a');
    expect(mocks.create.mock.calls[2][1]).toMatchObject({ resources: { cpu: 2, memory: 4, disk: 20 } });
  });

  it.each(['xl', '2xl', '3xl'] as const)('refuses %s above the sandbox limit without creating', async sizeClass => {
    const p = provider();
    const support = p.sizes.resolve(sizeClass);
    expect(support).toMatchObject({ status: 'unsupported', reason: expect.stringMatching(/4 vCPU.*8 GiB/) });
    await expect(p.instances.create({ sizeClass })).rejects.toMatchObject({ code: 'unsupported' });
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it.each([{ snapshotId: 'snap-a' }, { snapshot: 'snap-a' }])(
    'refuses a snapshot source that fixes resources (%j)', async source => {
      const support = provider().sizes.resolve('md', source as any);
      expect(support).toMatchObject({ status: 'unsupported', reason: expect.stringMatching(/snapshot/) });
      await expect(provider().instances.create({ sizeClass: 'md', ...source } as any)).rejects.toThrow(/snapshot/);
      expect(mocks.create).not.toHaveBeenCalled();
      expect(mocks.createFromSnapshot).not.toHaveBeenCalled();
    },
  );

  it.each([{ cpu: 2 }, { memory: 4096 }, { resources: { cpu: 2 } }, { disk: 20 }])(
    'rejects sizeClass combined with native resources (%j)', async native => {
      await expect(provider().instances.create({ sizeClass: 'md', ...native } as any))
        .rejects.toMatchObject({ code: 'conflict' });
      expect(mocks.create).not.toHaveBeenCalled();
    },
  );

  it('leaves non-sized creates unchanged', async () => {
    await provider().instances.create({ templateId: 'img-a' });
    const [image, params] = mocks.create.mock.calls[0];
    expect(image).toBe('img-a');
    expect(params.resources).toBeUndefined();

    mocks.createFromSnapshot.mockResolvedValue({ id: 'sb-snap' });
    await provider().instances.create({ snapshotId: 'snap-a' });
    const [snapshot, snapParams] = mocks.createFromSnapshot.mock.calls[0];
    expect(snapshot).toBe('snap-a');
    expect(snapParams.resources).toBeUndefined();
  });
});
