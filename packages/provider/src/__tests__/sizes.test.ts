import { describe, expect, it, vi } from 'vitest';
import { defineProvider, type InstanceMethods } from '../factory';
import { createCompute } from '../compute';
import { defineInfraProvider } from '../infra-factory';
import { createInstanceSizeManager, type InstanceSizeResolver } from '../sizes';
import type { Provider } from '../types/provider';

function fixture(sizes?: InstanceSizeResolver<{}>) {
  const methods: InstanceMethods<{}, {}> = {
    create: vi.fn().mockResolvedValue({ instance: {}, instanceId: 'one' }),
    getById: vi.fn().mockResolvedValue({ instance: {}, instanceId: 'one' }), list: vi.fn().mockResolvedValue([]),
    destroy: vi.fn(), runCommand: vi.fn().mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 }),
    getInfo: vi.fn(), getUrl: vi.fn(),
  };
  return { methods, provider: defineProvider({ name: 'test', sizes, methods: { instances: methods } })({}) };
}
const exact: InstanceSizeResolver<{}> = (_config, profile) => ({ status: 'supported', nativeOptions: { native: { cpu: profile.vcpus, memory: profile.memoryMiB } } });

describe('provider standard size framework', () => {
  it('leaves every legacy option and native size untouched, including undefined options', async () => {
    const { provider, methods } = fixture(exact);
    const options = { size: 'native', cpu: 7, other: { nested: true } };
    const result = await provider.instances.create(options);
    expect(methods.create).toHaveBeenLastCalledWith({}, options);
    expect(vi.mocked(methods.create).mock.calls[0][1]).toBe(options);
    expect(result.sizing).toBeUndefined();
    await provider.sandbox.create();
    expect(methods.create).toHaveBeenLastCalledWith({}, undefined);
    const explicitUndefined = { sizeClass: undefined, size: 'native', image: 'image', volumes: [] };
    await provider.instances.create(explicitUndefined);
    expect(vi.mocked(methods.create).mock.calls[2][1]).toBe(explicitUndefined);
    expect(provider.sandbox).toBe(provider.instances);
  });
  it('maps exact native options, strips SDK-only field and reports request, not observed resources', async () => {
    const { provider, methods } = fixture(exact);
    const options = { sizeClass: 'lg' as const, name: 'job' };
    const result = await provider.instances.create(options);
    expect(methods.create).toHaveBeenCalledWith({}, { name: 'job', native: { cpu: 4, memory: 8192 } });
    expect(options).toEqual({ sizeClass: 'lg', name: 'job' });
    expect(result.sizing).toEqual({ requested: { sizeClass: 'lg', vcpus: 4, memoryMiB: 8192 }, resolved: { vcpus: 4, memoryMiB: 8192 }, provenance: 'adapter-declared' });
    expect(Object.isFrozen(result.sizing)).toBe(true);
    expect(Object.isFrozen(result.sizing!.resolved)).toBe(true);
    expect((await provider.instances.getById('one'))!.sizing).toBeUndefined();
  });
  it('preserves signal identity and rejects pre-aborted requests without hook/create side effects', async () => {
    const resolver = vi.fn(exact);
    const { provider, methods } = fixture(resolver);
    const controller = new AbortController();
    await provider.instances.create({ sizeClass: 'sm', signal: controller.signal });
    expect(vi.mocked(methods.create).mock.calls[0][1]!.signal).toBe(controller.signal);
    controller.abort();
    resolver.mockClear();
    await expect(provider.instances.create({ sizeClass: 'sm', signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
    expect(resolver).not.toHaveBeenCalled();
    expect(methods.create).toHaveBeenCalledTimes(1);
  });
  it('keeps metadata independent across creates and never returns metadata on failure', async () => {
    const { provider, methods } = fixture(exact);
    const first = await provider.instances.create({ sizeClass: 'sm' });
    const next = await provider.instances.create({ sizeClass: 'xl' });
    expect(first.sizing!.requested.sizeClass).toBe('sm');
    expect(next.sizing!.requested.sizeClass).toBe('xl');
    expect(first.sizing).not.toBe(next.sizing);
    expect(() => { (first.sizing!.resolved as any).vcpus = 999; }).toThrow();
    expect(provider.sizes.resolve('sm')).toMatchObject({ resolved: { vcpus: 1 } });
    vi.mocked(methods.create).mockRejectedValueOnce(new Error('native create failed'));
    await expect(provider.instances.create({ sizeClass: 'md' })).rejects.toThrow('native create failed');
  });
  it.each(['unknown', 'unsupported', 'unconfigured', 'unavailable', 'requires-build'] as const)('fails %s before create with stable code', async status => {
    const { provider, methods } = fixture(() => ({ status, reason: 'not ready' }));
    expect(provider.sizes.resolve('sm')).toMatchObject({ status, reason: 'not ready' });
    expect(provider.sizes.resolve('sm')).not.toHaveProperty('resolved');
    await expect(provider.instances.create({ sizeClass: 'sm' })).rejects.toMatchObject({ code: status, fallback: false });
    expect(methods.create).not.toHaveBeenCalled();
  });
  it('unknown by default; invalid/conflicting requests never reach create', async () => {
    const { provider, methods } = fixture();
    expect(provider.sizes.list().every(size => size.status === 'unknown')).toBe(true);
    for (const [options, code] of [[{ sizeClass: 'sm' }, 'unknown'], [{ sizeClass: 'SM' }, 'invalid'], [{ sizeClass: 'sm', size: 'native' }, 'conflict']] as const) {
      await expect(provider.instances.create(options as any)).rejects.toMatchObject({ code });
    }
    expect(methods.create).not.toHaveBeenCalled();
  });
  it('rejects a resolver attempting to emit SDK-only sizeClass as a native option', async () => {
    const { provider, methods } = fixture(() => ({ status: 'supported', nativeOptions: { sizeClass: 'sm' } }));
    await expect(provider.instances.create({ sizeClass: 'sm' })).rejects.toMatchObject({ code: 'conflict' });
    expect(methods.create).not.toHaveBeenCalled();
  });
  it.each(['__proto__', 'prototype', 'constructor'])('rejects unsafe resource patch key %s without create or pollution', async key => {
    const patch = JSON.parse(`{"instanceOptions":{"shape":{"${key}":{"polluted":true}}}}`);
    const { provider, methods } = fixture(() => ({ status: 'supported', nativeOptions: patch }));
    await expect(provider.instances.create({ sizeClass: 'sm' })).rejects.toMatchObject({ code: 'invalid' });
    expect(methods.create).not.toHaveBeenCalled();
    expect((Object.prototype as any).polluted).toBeUndefined();
  });
  it.each(['__proto__', 'prototype', 'constructor'])('rejects unsafe caller shape key %s while leaving the no-class path unchanged', async key => {
    const { provider, methods } = fixture(exact);
    const instanceOptions = JSON.parse(`{"shape":{"${key}":{"polluted":true}}}`);
    await expect(provider.instances.create({ sizeClass: 'sm', instanceOptions })).rejects.toMatchObject({ code: 'invalid' });
    expect(methods.create).not.toHaveBeenCalled();
    await provider.instances.create({ instanceOptions });
    expect(methods.create).toHaveBeenCalledWith({}, { instanceOptions });
    expect((Object.prototype as any).polluted).toBeUndefined();
  });
  it('rejects context and patch accessors without invoking them', async () => {
    const getter = vi.fn(() => 1);
    const { provider, methods } = fixture(exact);
    const shape = Object.defineProperty({}, 'virtual_cpu', { enumerable: true, get: getter });
    await expect(provider.instances.create({ sizeClass: 'sm', instanceOptions: { shape } })).rejects.toMatchObject({ code: 'invalid' });
    const options = Object.defineProperty({}, 'sizeClass', { enumerable: true, get: getter });
    await expect(provider.instances.create(options)).rejects.toMatchObject({ code: 'invalid' });
    const native = Object.defineProperty({}, 'cpu', { enumerable: true, get: getter });
    const malformed = fixture(() => ({ status: 'supported', nativeOptions: native }));
    await expect(malformed.provider.instances.create({ sizeClass: 'sm' })).rejects.toMatchObject({ code: 'invalid' });
    expect(getter).not.toHaveBeenCalled();
    expect(methods.create).not.toHaveBeenCalled();
    expect(malformed.methods.create).not.toHaveBeenCalled();
  });
  it.each(['create', 'resolve', 'list'] as const)('rejects symbol-key accessors before %s can invoke getters or hooks', async route => {
    const getter = vi.fn(() => 'dummy');
    const resolver = vi.fn(exact);
    const { provider, methods } = fixture(resolver);
    const options = Object.defineProperty({ sizeClass: 'sm' as const }, Symbol('probe'), { enumerable: true, get: getter });
    if (route === 'create') await expect(provider.instances.create(options)).rejects.toMatchObject({ code: 'invalid' });
    else expect(() => route === 'resolve' ? provider.sizes.resolve('sm', options) : provider.sizes.list(options)).toThrowError(/sizeClass/);
    expect(getter).not.toHaveBeenCalled(); expect(resolver).not.toHaveBeenCalled(); expect(methods.create).not.toHaveBeenCalled();
  });
  it('rejects symbol keys in emitted resource patches without invoking their accessors', async () => {
    const getter = vi.fn(() => 1);
    const patch = Object.defineProperty({}, Symbol('resource'), { enumerable: true, get: getter });
    const { provider, methods } = fixture(() => ({ status: 'supported', nativeOptions: patch }));
    await expect(provider.instances.create({ sizeClass: 'sm' })).rejects.toMatchObject({ code: 'invalid' });
    expect(getter).not.toHaveBeenCalled(); expect(methods.create).not.toHaveBeenCalled();
  });
  it.each(['create', 'resolve', 'list'] as const)('rejects non-enumerable sizeClass through %s', async route => {
    const { provider, methods } = fixture(exact);
    const options = Object.defineProperty({}, 'sizeClass', { value: 'sm' });
    if (route === 'create') await expect(provider.instances.create(options)).rejects.toMatchObject({ code: 'invalid' });
    else expect(() => route === 'resolve' ? provider.sizes.resolve('sm', options) : provider.sizes.list(options)).toThrowError(/sizeClass/);
    expect(methods.create).not.toHaveBeenCalled();
  });
  it('rejects a non-enumerable signal rather than creating without cancellation', async () => {
    const { provider, methods } = fixture(exact);
    const controller = new AbortController();
    const options = Object.defineProperty({ sizeClass: 'sm' as const }, 'signal', { value: controller.signal });
    await expect(provider.instances.create(options)).rejects.toMatchObject({ code: 'invalid' });
    expect(methods.create).not.toHaveBeenCalled();
  });
  it('rejects defined standard fields on function options in factory, createCompute and infra facades', async () => {
    const { provider, methods } = fixture();
    const options = Object.assign(() => {}, { sizeClass: 'sm' });
    await expect(provider.instances.create(options as any)).rejects.toMatchObject({ code: 'invalid' });
    await expect(createCompute({ provider }).instances.create(options as any)).rejects.toMatchObject({ code: 'invalid' });
    const create = vi.fn().mockResolvedValue({ instance: {}, instanceId: 'bad' });
    const infra = defineInfraProvider({ name: 'infra', methods: { create, getById: vi.fn(), list: vi.fn(), destroy: vi.fn() } })({});
    await expect(infra.create(options as any)).rejects.toMatchObject({ code: 'invalid' });
    expect(methods.create).not.toHaveBeenCalled(); expect(create).not.toHaveBeenCalled();
  });
  it('retains legacy descriptor/callable passthrough when sizeClass is undefined', async () => {
    const { provider, methods } = fixture();
    const getter = vi.fn(() => 'legacy-symbol');
    const options = Object.defineProperty(Object.defineProperty({ sizeClass: undefined }, 'signal', {
      value: new AbortController().signal,
    }), Symbol('legacy'), { enumerable: true, get: getter });
    await provider.instances.create(options);
    expect(vi.mocked(methods.create).mock.calls[0][1]).toBe(options);
    const callable = Object.defineProperty(() => {}, 'sizeClass', { value: undefined });
    await provider.instances.create(callable as any);
    expect(vi.mocked(methods.create).mock.calls[1][1]).toBe(callable);
    expect(getter).not.toHaveBeenCalled();
  });
  it('accepts null-prototype resource data and preserves unrelated live object identities', async () => {
    const patch = Object.assign(Object.create(null), { instanceOptions: Object.assign(Object.create(null), {
      shape: Object.assign(Object.create(null), { virtual_cpu: 1, memory_megabytes: 2048 }),
    }) });
    const { provider, methods } = fixture(() => ({ status: 'supported', nativeOptions: patch }));
    const signal = new AbortController().signal;
    const metadata = { token: 'dummy-secret' };
    const options = Object.assign(Object.create(null), { sizeClass: 'sm', signal, metadata,
      instanceOptions: Object.assign(Object.create(null), { authorization: 'dummy-secret', shape: Object.assign(Object.create(null), { os: 'linux' }) }),
    });
    const result = await provider.instances.create(options);
    const actual = vi.mocked(methods.create).mock.calls[0][1]!;
    expect(actual.signal).toBe(signal); expect(actual.metadata).toBe(metadata);
    expect(actual.instanceOptions).toEqual({ authorization: 'dummy-secret', shape: { os: 'linux', virtual_cpu: 1, memory_megabytes: 2048 } });
    expect(JSON.stringify(result.sizing)).not.toContain('dummy-secret');
    expect(Object.isFrozen(options)).toBe(false); expect(Object.isFrozen(options.instanceOptions.shape)).toBe(false);
  });
  it('freezes copies, not resolver/caller inputs; discovery never creates resources', () => {
    const native = { nested: { cpu: 2 } };
    const resolver = vi.fn(() => ({ status: 'supported' as const, nativeOptions: native }));
    const { provider, methods } = fixture(resolver);
    const resolved = provider.sizes.resolve('md');
    expect(Object.isFrozen(resolved)).toBe(true);
    expect(Object.isFrozen(resolved.requested)).toBe(true);
    expect(Object.isFrozen(provider.sizes)).toBe(true);
    expect(() => { (provider as any).sizes = {}; }).toThrow();
    expect(Object.isFrozen(provider.sizes.list())).toBe(true);
    expect(Object.isFrozen(native.nested)).toBe(false);
    native.nested.cpu = 99;
    if (resolved.status === 'supported') expect(resolved.nativeOptions).toEqual({ nested: { cpu: 2 } });
    expect(methods.create).not.toHaveBeenCalled();
    expect(() => provider.sizes.resolve('sm', { sizeClass: 'lg' })).toThrow(/resolve size differs/);
  });
  it('guards createCompute legacy custom providers and infra providers', async () => {
    const { provider, methods } = fixture();
    const custom = { ...provider, sizes: undefined };
    await expect(createCompute({ provider: custom }).sandbox.create({ sizeClass: 'sm' })).rejects.toMatchObject({ code: 'unknown' });
    expect(methods.create).not.toHaveBeenCalled();
    const infraCreate = vi.fn();
    const infra = defineInfraProvider({ name: 'infra', methods: { create: infraCreate, getById: vi.fn(), list: vi.fn(), destroy: vi.fn() } })({});
    await expect(infra.create({ sizeClass: 'sm' })).rejects.toMatchObject({ code: 'unknown' });
    expect(infraCreate).not.toHaveBeenCalled();
    expect(createInstanceSizeManager({}).resolve('md').status).toBe('unknown');
  });
  it.each([{ sizes: ['native'] }, { sizes: () => ['native'] }, { sizes: { native: 'tier' } }])(
    'accepts unrelated legacy Provider extensions without weakening standard preflight: %j', async ({ sizes }) => {
      const { provider, methods } = fixture();
      const legacy: Provider = { ...provider, sizes };
      const sdk = createCompute({ provider: legacy });
      await sdk.instances.create({ size: 'native' });
      await expect(sdk.instances.create({ sizeClass: 'sm' })).rejects.toMatchObject({ code: 'unknown' });
      expect(methods.create).toHaveBeenCalledTimes(1);
    });
});
