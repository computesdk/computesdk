import { beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * Ways the Upstash standard-size mapping could fail:
 * - wrong shape: a class maps to the wrong Box `size` (e.g. md -> medium), or to a
 *   tier below the profile (sm -> small is above it, xl -> medium is below it);
 * - silent default boot: an unmapped class (xs, sm, 2xl, 3xl) reaches the vendor and
 *   boots the default `small` box instead of being refused;
 * - dropped field: `size` is lost on one create path (new box, snapshot restore,
 *   ephemeral create, ephemeral restore), so Upstash boots `small`;
 * - leaked field: SDK-only `sizeClass` is spread into the vendor body;
 * - conflict accepted: `sizeClass` combined with native `size` (or cpu/memory) is
 *   forwarded instead of rejected with InstanceSizeError('conflict');
 * - wrong metadata: `resolved` omits the tier's fixed disk or reports a shape the
 *   tier does not list.
 */
const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  restore: vi.fn(),
  ephemeralCreate: vi.fn(),
  ephemeralRestore: vi.fn(),
}));

vi.mock('@upstash/box', () => ({
  Box: class {
    static create = mocks.create;
    static fromSnapshot = mocks.restore;
  },
  EphemeralBox: class {
    static create = mocks.ephemeralCreate;
    static fromSnapshot = mocks.ephemeralRestore;
  },
}));

import { upstash } from '../index';

const mapped = [
  ['md', 'small', 2, 4096, 10240],
  ['lg', 'medium', 4, 8192, 30720],
  ['xl', 'large', 8, 16384, 30720],
] as const;

const vendorCalls = () => Object.values(mocks).reduce((n, mock) => n + mock.mock.calls.length, 0);
const lastArg = (mock: (typeof mocks)[keyof typeof mocks]) => {
  const args = mock.mock.calls[0];
  return args[args.length - 1];
};

describe('Upstash standard size mapping (mock-only)', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    for (const mock of Object.values(mocks)) mock.mockResolvedValue({ id: 'box-test' });
  });

  it('discovers sizes without credentials or vendor calls', () => {
    const sizes = upstash({}).sizes;
    const list = sizes.list();
    expect(list.filter(r => r.status === 'supported').map(r => r.requested.sizeClass)).toEqual(['md', 'lg', 'xl']);
    for (const sizeClass of ['xs', 'sm', '2xl', '3xl'] as const) {
      const resolution = sizes.resolve(sizeClass);
      expect(resolution.status).toBe('unsupported');
      expect(resolution).toMatchObject({ reason: expect.stringMatching(/Upstash Box/) });
    }
    expect(vendorCalls()).toBe(0);
  });

  it.each(mapped)('resolves %s to the %s Box (%i vCPU / %i MiB / %i MiB disk)', (sizeClass, size, vcpus, memoryMiB, diskMiB) => {
    expect(upstash({}).sizes.resolve(sizeClass)).toMatchObject({
      status: 'supported',
      nativeOptions: { size },
      resolved: { vcpus, memoryMiB, diskMiB },
      provenance: 'adapter-declared',
    });
  });

  it.each(mapped)('creates a new %s box with size %s and no sizeClass', async (sizeClass, size, vcpus, memoryMiB, diskMiB) => {
    const sandbox = await upstash({ apiKey: 'test-key' }).instances.create({ sizeClass });
    expect(mocks.create).toHaveBeenCalledTimes(1);
    const body = lastArg(mocks.create);
    expect(body.size).toBe(size);
    expect(body).not.toHaveProperty('sizeClass');
    expect(sandbox.sizing).toMatchObject({ requested: { sizeClass }, resolved: { vcpus, memoryMiB, diskMiB } });
  });

  it.each([
    [{ snapshotId: 'snap-test' }, 'restore'],
    [{ ephemeral: true }, 'ephemeralCreate'],
    [{ ephemeral: true, snapshotId: 'snap-test' }, 'ephemeralRestore'],
  ] as const)('forwards size on the other create paths (%j)', async (options, method) => {
    await upstash({ apiKey: 'test-key' }).instances.create({ ...options, sizeClass: 'xl' });
    expect(mocks[method]).toHaveBeenCalledTimes(1);
    expect(lastArg(mocks[method])).toMatchObject({ size: 'large' });
    expect(lastArg(mocks[method])).not.toHaveProperty('sizeClass');
  });

  it.each(['xs', 'sm', '2xl', '3xl'] as const)('refuses %s before calling Upstash', async sizeClass => {
    await expect(upstash({ apiKey: 'test-key' }).instances.create({ sizeClass })).rejects.toMatchObject({
      name: 'InstanceSizeError', code: 'unsupported', fallback: false,
    });
    expect(vendorCalls()).toBe(0);
  });

  it.each([{ size: 'large' }, { size: 'small' }, { cpu: 2 }, { memory: 4096 }])('rejects sizeClass with native %j', async extra => {
    const provider = upstash({ apiKey: 'test-key' });
    await expect(provider.instances.create({ sizeClass: 'md', ...extra })).rejects.toMatchObject({ code: 'conflict' });
    expect(() => provider.sizes.resolve('md', extra)).toThrow(expect.objectContaining({ code: 'conflict' }));
    expect(vendorCalls()).toBe(0);
  });

  it('keeps the Upstash default size when sizeClass is omitted', async () => {
    await upstash({ apiKey: 'test-key' }).instances.create({});
    expect(lastArg(mocks.create).size).toBeUndefined();
  });
});
