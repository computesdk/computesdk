import { describe, expect, it, vi } from 'vitest';
import { compute, type DirectProvider } from '../compute';
import { createInstanceSizeManager } from '../provider/sizes';
import { INSTANCE_SIZE_PROFILES, InstanceSizeError, getInstanceSizeProfile, type InstanceSizeClass, type InstanceSizeManager } from '../sizes';

function provider(name = 'legacy', sizes?: InstanceSizeManager): DirectProvider {
  return { name, sizes, sandbox: { create: vi.fn().mockResolvedValue({ instanceId: name }), getById: vi.fn(), destroy: vi.fn() } };
}
const supported: InstanceSizeManager = {
  contract: 'computesdk.instance-sizes.v1',
  list: () => [],
  resolve: sizeClass => ({ status: 'supported', requested: getInstanceSizeProfile(sizeClass), provenance: 'adapter-declared', resolved: {
    vcpus: getInstanceSizeProfile(sizeClass).vcpus, memoryMiB: getInstanceSizeProfile(sizeClass).memoryMiB,
  }, nativeOptions: {} }),
};

describe('standard sizing core contract', () => {
  it('defines immutable explicit CPU/MiB targets (sm matches benchmark S)', () => {
    expect(Object.values(INSTANCE_SIZE_PROFILES).map(p => [p.sizeClass, p.vcpus, p.memoryMiB])).toEqual([
      ['xs', 1, 1024], ['sm', 1, 2048], ['md', 2, 4096], ['lg', 4, 8192], ['xl', 8, 16384], ['2xl', 16, 32768], ['3xl', 32, 65536],
    ]);
    expect(Object.isFrozen(INSTANCE_SIZE_PROFILES)).toBe(true);
    expect(Object.isFrozen(INSTANCE_SIZE_PROFILES.sm)).toBe(true);
  });
  it.each(['bogus', 'S', '', null, 4, {}, Object.create(null), '__proto__'])('rejects invalid runtime size %s before any custom create', async value => {
    const p = provider();
    await expect(compute({ provider: p }).instances.create({ sizeClass: value as InstanceSizeClass })).rejects.toMatchObject({ code: 'invalid', fallback: false });
    expect(p.sandbox!.create).not.toHaveBeenCalled();
  });
  it.each(['size', 'cpu', 'cpuLimit', 'cpus', 'vcpus', 'memory', 'memoryMiB', 'memMiB', 'memoryMb', 'resources', 'launch_parameters', 'deploymentPlan', 'vmTier'])(
    'rejects conflicting %s before custom create', async field => {
      const p = provider('declared', supported);
      await expect(compute({ provider: p }).instances.create({ sizeClass: 'sm', [field]: 1 })).rejects.toMatchObject({ code: 'conflict' });
      expect(p.sandbox!.create).not.toHaveBeenCalled();
    });
  it('guards singleton and callable legacy custom providers without requiring new interfaces', async () => {
    const p = provider();
    const legacy = { size: 'provider-native-small', memory: 777, custom: { keep: true } };
    await compute({ provider: p }).sandbox.create(legacy);
    expect(p.sandbox!.create).toHaveBeenCalledWith(legacy);
    compute.setConfig({ provider: p });
    await expect(compute.instances.create({ sizeClass: 'sm' })).rejects.toBeInstanceOf(InstanceSizeError);
    expect(p.sandbox!.create).toHaveBeenCalledTimes(1);
  });
  it('never skips an unknown provider or falls back on standard-size errors', async () => {
    const first = provider(); const second = provider('declared', supported);
    await expect(compute({ providers: [first, second], fallbackOnError: true }).instances.create({ sizeClass: 'md' })).rejects.toMatchObject({ code: 'unknown' });
    expect(first.sandbox!.create).not.toHaveBeenCalled(); expect(second.sandbox!.create).not.toHaveBeenCalled();
  });
  it('rejects unrelated legacy sizes properties and malformed contracts with a typed error', async () => {
    for (const sizes of [[], { resolve: () => ({ status: 'supported' }) }, { ...supported, resolve: () => ({ status: 'supported' }) }]) {
      const p = provider('custom', sizes as any);
      await expect(compute({ provider: p }).instances.create({ sizeClass: 'sm' })).rejects.toMatchObject({ code: 'unknown', fallback: false });
      expect(p.sandbox!.create).not.toHaveBeenCalled();
    }
  });
  it.each([{ sizes: ['native'] }, { sizes: () => ['native'] }, { sizes: { native: 'tier' } }])(
    'keeps no-class legacy extensions source-compatible and rejects their standard requests: %j', async ({ sizes }) => {
      const base = provider();
      const legacy = { ...base, sizes };
      await compute({ provider: legacy }).instances.create({ size: 'native' });
      await expect(compute({ provider: legacy }).instances.create({ sizeClass: 'sm' })).rejects.toMatchObject({ code: 'unknown' });
      expect(base.sandbox!.create).toHaveBeenCalledTimes(1);
    });
  it('does not silently lose inherited sizeClass through routing option spreads', async () => {
    const p = provider('custom', supported);
    await expect(compute({ provider: p }).instances.create(Object.create({ sizeClass: 'sm' }))).rejects.toMatchObject({ code: 'invalid' });
    expect(p.sandbox!.create).not.toHaveBeenCalled();
  });
  it('rejects non-enumerable standard fields before routing or fallback can lose them', async () => {
    const first = provider(); const second = provider('ready', supported);
    const options = Object.defineProperty({}, 'sizeClass', { value: 'sm' });
    await expect(compute({ providers: [first, second], fallbackOnError: true }).instances.create(options)).rejects.toMatchObject({ code: 'invalid' });
    expect(first.sandbox!.create).not.toHaveBeenCalled(); expect(second.sandbox!.create).not.toHaveBeenCalled();
  });
  it('rejects callable options carrying a defined standard request rather than treating them as legacy', async () => {
    const p = provider();
    const options = Object.assign(() => {}, { sizeClass: 'sm' });
    await expect(compute({ provider: p }).instances.create(options as any)).rejects.toMatchObject({ code: 'invalid' });
    expect(p.sandbox!.create).not.toHaveBeenCalled();
  });
  it('never invokes a symbol-key accessor while routing a standard request', async () => {
    const p = provider('ready', supported);
    const getter = vi.fn(() => 'dummy');
    const options = Object.defineProperty({ sizeClass: 'sm' as const }, Symbol('probe'), { enumerable: true, get: getter });
    await expect(compute({ provider: p }).instances.create(options)).rejects.toMatchObject({ code: 'invalid' });
    expect(getter).not.toHaveBeenCalled(); expect(p.sandbox!.create).not.toHaveBeenCalled();
  });
  it('keeps round-robin policy but preflights without rerouting unknown/unavailable providers', async () => {
    const blocked = provider('blocked', { ...supported, resolve: sizeClass => ({
      status: 'unavailable', requested: getInstanceSizeProfile(sizeClass), provenance: 'adapter-declared', reason: 'mode',
    }) });
    const ready = provider('ready', supported);
    const sdk = compute({ providers: [blocked, ready], providerStrategy: 'round-robin', fallbackOnError: true });
    await expect(sdk.instances.create({ sizeClass: 'sm' })).rejects.toMatchObject({ code: 'unavailable' });
    expect(blocked.sandbox!.create).not.toHaveBeenCalled(); expect(ready.sandbox!.create).not.toHaveBeenCalled();
    await sdk.instances.create({ sizeClass: 'sm' });
    expect(ready.sandbox!.create).toHaveBeenCalledTimes(1);
  });
  it('honors explicit routing and never falls back after a supported create fails', async () => {
    const first = provider(); const second = provider('declared', supported);
    await compute({ providers: [first, second] }).instances.create({ sizeClass: 'md', provider: 'declared' });
    expect(first.sandbox!.create).not.toHaveBeenCalled();
    expect(second.sandbox!.create).toHaveBeenCalledWith({ sizeClass: 'md' });
    const nativeError = Object.assign(new Error('capacity'), { code: 'native-capacity', fallback: true });
    vi.mocked(second.sandbox!.create).mockRejectedValueOnce(nativeError);
    await expect(compute({ providers: [second, first], fallbackOnError: true }).instances.create({ sizeClass: 'md' })).rejects.toBe(nativeError);
    expect(first.sandbox!.create).not.toHaveBeenCalled();
  });
  // vCPU picks the class; RAM is a floor with a 10% tolerance, and extra RAM is recorded.
  const shape = (resolved: object, belowStandard?: string) =>
    createInstanceSizeManager({}, () => ({ status: 'supported' as const, nativeOptions: {}, resolved: resolved as never, ...(belowStandard ? { belowStandard } : {}) }));
  it('records a listed shape with more RAM and its disk', () => {
    const sizes = createInstanceSizeManager({}, () => ({ status: 'supported', nativeOptions: { tier: 'large' }, resolved: { vcpus: 32, memoryMiB: 131072, diskMiB: 65536 } }));
    expect(sizes.resolve('3xl')).toMatchObject({ status: 'supported', resolved: { vcpus: 32, memoryMiB: 131072, diskMiB: 65536 } });
    expect(shape({ vcpus: 1, memoryMiB: 2048 }).resolve('xs')).toMatchObject({ status: 'supported', resolved: { vcpus: 1, memoryMiB: 2048 } });
    expect(shape({ vcpus: 2, memoryMiB: 8192 }).resolve('md')).not.toHaveProperty('memoryShortfallMiB');
  });
  it('rejects a shape whose vCPU is outside the class', () => {
    expect(() => shape({ vcpus: 4, memoryMiB: 8192 }).resolve('md')).toThrow(InstanceSizeError); // that is lg
    expect(() => shape({ vcpus: 2, memoryMiB: 4096 }).resolve('sm')).toThrow(InstanceSizeError);
    expect(() => shape({ vcpus: 4, memoryMiB: 16384 }).resolve('xl')).toThrow(InstanceSizeError);
    // The top class has no next class, so any vCPU at or above it qualifies.
    expect(shape({ vcpus: 64, memoryMiB: 131072 }).resolve('3xl')).toMatchObject({ status: 'supported' });
  });
  it('accepts RAM up to 10% below the profile only with belowStandard, and records the shortfall', () => {
    const tensorlake = { vcpus: 8, memoryMiB: 16000 };
    expect(() => shape(tensorlake).resolve('xl')).toThrow(InstanceSizeError);
    expect(shape(tensorlake, 'Tensorlake caps RAM at 16000 MB').resolve('xl'))
      .toMatchObject({ status: 'supported', resolved: tensorlake, belowStandard: 'Tensorlake caps RAM at 16000 MB', memoryShortfallMiB: 384 });
    expect(shape({ vcpus: 8, memoryMiB: 14746 }, 'cap').resolve('xl')).toMatchObject({ memoryShortfallMiB: 1638 });
    expect(() => shape({ vcpus: 8, memoryMiB: 14745 }, 'cap').resolve('xl')).toThrow(InstanceSizeError);
    expect(() => shape({ vcpus: 32, memoryMiB: 49152 }, 'Max plan caps RAM at 48 GiB').resolve('3xl')).toThrow(InstanceSizeError);
    expect(() => shape({ vcpus: 8, memoryMiB: 16384 }, 'not below').resolve('xl')).toThrow(InstanceSizeError);
  });
  it.each([{ vcpus: 0, memoryMiB: 2048 }, { vcpus: 1.5, memoryMiB: 2048 }, { vcpus: 1, memoryMiB: Number.NaN }, { vcpus: 1, memoryMiB: 2048, diskMiB: -1 }])(
    'rejects a non-positive or fractional shape %o', resolved => {
      expect(() => createInstanceSizeManager({}, () => ({ status: 'supported', nativeOptions: {}, resolved })).resolve('sm')).toThrow(InstanceSizeError);
    });
});
