import type { CreateInstanceOptions } from '@computesdk/provider';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { namespace } from '../index';

// Sizing could pick the wrong class, CPU, RAM, disk, or platform; silently boot
// defaults for an unsupported class; drop a field when sending a normal,
// image-based, or volume-restore create; or accept a competing native CPU/RAM
// selector. Discovery could also require credentials or disagree with create.
const profiles = [
  ['sm', 1, 2048, 40960],
  ['md', 2, 4096, 49152],
  ['lg', 4, 8192, 65536],
  ['xl', 8, 16384, 98304],
  ['2xl', 16, 32768, 163840],
  ['3xl', 32, 131072, 557056],
] as const;

function mockFetch() {
  const fetch = vi.fn(async (url: string, _init: RequestInit) => ({
    ok: true,
    json: async () => url.endsWith('/DescribePersistentVolume')
      ? { volume: { sizeMb: 2048, site: 'iad3-a.nscluster.cloud' } }
      : { metadata: { instanceId: 'new' }, extendedMetadata: { commandServiceEndpoint: 'https://cmd.invalid' } },
  }));
  vi.stubGlobal('fetch', fetch);
  return fetch;
}

describe('Namespace standard size mapping (mock-only)', () => {
  afterEach(() => { vi.unstubAllGlobals(); });
  it('discovers sizes purely without credentials, files, or API calls', () => {
    const fetch = mockFetch();
    const sizes = namespace({ tokenFile: '/must-not-read' }).sizes;
    expect(sizes.list().filter(p => p.status === 'supported').map(p => p.requested.sizeClass))
      .toEqual(profiles.map(([sizeClass]) => sizeClass));
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each(profiles)('maps %s to the published shape and overrides only config defaults', async (sizeClass, cpu, memory, diskMiB) => {
    const fetch = mockFetch();
    const provider = namespace({ token: 'test', virtualCpu: 99, memoryMegabytes: 99999 });
    const options = { sizeClass, instanceOptions: { workload_permissions: [{ action: 'read' }], shape: { os: 'linux' } } };
    const shape = { os: 'linux', machine_arch: 'amd64', virtual_cpu: cpu, memory_megabytes: memory };
    const resolved = { vcpus: cpu, memoryMiB: memory, diskMiB };
    const resolution = provider.sizes.resolve(sizeClass, options);
    expect(resolution).toMatchObject({ status: 'supported', resolved });
    expect(resolution).toHaveProperty('nativeOptions', { instanceOptions: { shape } });
    const result = await provider.instances.create(options);
    const body = JSON.parse(String(fetch.mock.calls[0][1].body));
    expect(body.shape).toEqual(shape);
    expect(body.workload_permissions).toEqual([{ action: 'read' }]);
    expect(body).not.toHaveProperty('sizeClass');
    expect(result.sizing).toEqual({ requested: { sizeClass, vcpus: cpu, memoryMiB: memory }, resolved, provenance: 'adapter-declared' });
    expect(options.instanceOptions.shape).toEqual({ os: 'linux' });
  });
  it('forwards the mapped shape with a custom image and a restored volume', async () => {
    const fetch = mockFetch();
    const provider = namespace({ token: 'test' });
    await provider.sandbox.create({ sizeClass: '3xl', image: 'example.invalid/custom:1', snapshotId: 'data/vol_1' });
    const create = fetch.mock.calls.find(([url]) => url.endsWith('/CreateInstance'));
    expect(create).toBeDefined();
    expect(JSON.parse(String(create![1].body))).toMatchObject({
      shape: { os: 'linux', machine_arch: 'amd64', virtual_cpu: 32, memory_megabytes: 131072 },
      containers: [{ image_ref: 'example.invalid/custom:1' }],
      placement: ['cell:iad3-a'],
      volumes: [{ from_snapshot_id: 'vol_1', tag: 'data', size_mb: 2048 }],
    });
  });
  it('rejects xs before credentials or restore lookups', async () => {
    const fetch = mockFetch();
    const provider = namespace({ tokenFile: '/must-not-read' });
    expect(provider.sizes.resolve('xs')).toMatchObject({ status: 'unsupported', reason: /minimum.*2 GiB/ });
    await expect(provider.sandbox.create({ sizeClass: 'xs', snapshotId: 'data/vol_1' }))
      .rejects.toMatchObject({ code: 'unsupported', fallback: false });
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each([
    { sizeClass: 'sm', instanceOptions: { shape: { virtual_cpu: 1 } } },
    { sizeClass: 'sm', instanceOptions: { shape: { memory_megabytes: 2048 } } },
    { sizeClass: 'sm', instanceOptions: { shape: { virtualCpu: 1 } } },
    { sizeClass: 'sm', instanceOptions: { shape: { memoryMegabytes: 2048 } } },
    { sizeClass: 'sm', virtualCpu: 1 }, { sizeClass: 'sm', memoryMegabytes: 2048 },
    { sizeClass: 'sm', virtual_cpu: 1 }, { sizeClass: 'sm', memory_megabytes: 2048 },
    { sizeClass: 'sm', size: 'native' },
  ] as const)('rejects a conflicting request without API call: %j', async options => {
    const fetch = mockFetch();
    await expect(namespace({ token: 'test' }).instances.create(options)).rejects.toMatchObject({ code: 'conflict', fallback: false });
    expect(fetch).not.toHaveBeenCalled();
  });
  it('rejects an invalid size class before create', async () => {
    const fetch = mockFetch();
    const options = { sizeClass: 'wrong' } as unknown as CreateInstanceOptions;
    await expect(namespace({}).instances.create(options)).rejects.toMatchObject({ code: 'invalid', fallback: false });
    expect(fetch).not.toHaveBeenCalled();
  });
  it('uses the validated enumerable platform override in both resolution and the native request', async () => {
    const fetch = mockFetch();
    const provider = namespace({ token: 'test', os: 'macos', machineArch: 'arm64' });
    const options = { sizeClass: 'sm' as const, instanceOptions: { shape: { os: 'linux', machine_arch: 'amd64' } } };
    expect(provider.sizes.resolve('sm', options)).toMatchObject({
      status: 'supported', nativeOptions: { instanceOptions: { shape: {
        virtual_cpu: 1, memory_megabytes: 2048, os: 'linux', machine_arch: 'amd64',
      } } },
    });
    await provider.instances.create(options);
    expect(JSON.parse(String(fetch.mock.calls[0][1].body)).shape).toEqual({
      virtual_cpu: 1, memory_megabytes: 2048, os: 'linux', machine_arch: 'amd64',
    });
  });
  it('pins the validated platform even if factory defaults change during credential await', async () => {
    const fetch = mockFetch();
    const config = { token: 'test', os: 'linux', machineArch: 'amd64' };
    const create = namespace(config).instances.create({ sizeClass: 'sm' });
    config.os = 'macos'; config.machineArch = 'arm64';
    await create;
    expect(JSON.parse(String(fetch.mock.calls[0][1].body)).shape).toMatchObject({ os: 'linux', machine_arch: 'amd64' });
  });
  it.each([null, [], 'invalid', 7])('rejects malformed native shape %j before credentials/API', async shape => {
    const fetch = mockFetch();
    await expect(namespace({ tokenFile: '/must-not-read' }).instances.create({ sizeClass: 'sm', instanceOptions: { shape } })).rejects.toMatchObject({ code: 'invalid' });
    expect(fetch).not.toHaveBeenCalled();
  });
  it('rejects non-Linux container creates and leaves ambiguous Linux ARM64 shapes unknown', async () => {
    const fetch = mockFetch();
    for (const os of ['macos', 'windows']) {
      const provider = namespace({ os });
      expect(provider.sizes.resolve('sm').status).toBe('unsupported');
      await expect(provider.instances.create({ sizeClass: 'sm' })).rejects.toMatchObject({ code: 'unsupported' });
    }
    const arm = namespace({ machineArch: 'arm64' });
    expect(arm.sizes.resolve('sm').status).toBe('unknown');
    await expect(arm.instances.create({ sizeClass: 'sm' })).rejects.toMatchObject({ code: 'unknown' });
    await expect(namespace({}).instances.create({ sizeClass: 'sm', instanceOptions: { shape: { os: 'macos' } } }))
      .rejects.toMatchObject({ code: 'unsupported' });
    expect(fetch).not.toHaveBeenCalled();
  });
  it('rejects unlisted Linux architectures', async () => {
    const fetch = mockFetch();
    const provider = namespace({ machineArch: 'riscv64' });
    expect(provider.sizes.resolve('sm').status).toBe('unsupported');
    await expect(provider.instances.create({ sizeClass: 'sm' })).rejects.toMatchObject({ code: 'unsupported' });
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each([
    ['non-enumerable instanceOptions', Object.defineProperty({}, 'instanceOptions', { value: { shape: { os: 'linux' } } })],
    ['non-enumerable shape', { instanceOptions: Object.defineProperty({}, 'shape', { value: { os: 'linux' } }) }],
    ['non-enumerable os', { instanceOptions: { shape: Object.defineProperty({}, 'os', { value: 'linux' }) } }],
    ['non-enumerable architecture', { instanceOptions: { shape: Object.defineProperty({}, 'machine_arch', { value: 'amd64' }) } }],
    ['null os', { instanceOptions: { shape: { os: null } } }],
    ['undefined os', { instanceOptions: { shape: { os: undefined } } }],
    ['numeric os', { instanceOptions: { shape: { os: 1 } } }],
    ['null architecture', { instanceOptions: { shape: { machine_arch: null } } }],
    ['undefined architecture', { instanceOptions: { shape: { machine_arch: undefined } } }],
    ['camelCase architecture', { instanceOptions: { shape: { machineArch: 'amd64' } } }],
  ])('rejects %s before a platform context can diverge from its native request', async (_name, context) => {
    const fetch = mockFetch();
    const provider = namespace({ token: 'test' });
    // Preserve the original descriptor forms; spreading the test context would hide the bug.
    const options: CreateInstanceOptions = Object.defineProperty(context, 'sizeClass', { value: 'sm', enumerable: true });
    await expect(provider.instances.create(options)).rejects.toMatchObject({ code: 'invalid' });
    expect(() => provider.sizes.resolve('sm', options)).toThrowError(/sizeClass/);
    expect(() => provider.sizes.list(options)).toThrowError(/sizeClass/);
    expect(fetch).not.toHaveBeenCalled();
  });
  it('preserves legacy per-create native shape and native size fields', async () => {
    const fetch = mockFetch();
    const result = await namespace({ token: 'test' }).instances.create({ size: 'native', instanceOptions: { shape: { virtual_cpu: 3, memory_megabytes: 3333 } } });
    expect(JSON.parse(String(fetch.mock.calls[0][1].body)).shape).toMatchObject({ virtual_cpu: 3, memory_megabytes: 3333 });
    expect(result.sizing).toBeUndefined();
  });
  it('preserves native sentinels operationally without promoting secrets into sizing/catalog/errors', async () => {
    const fetch = mockFetch();
    const secret = 'dummy-sizing-secret-sentinel';
    const provider = namespace({ token: secret });
    const options = {
      sizeClass: 'sm' as const, envs: { TOKEN: secret }, metadata: { token: secret },
      instanceOptions: { authorization: secret, custom: { token: secret }, shape: { os: 'linux' } },
      containerOptions: { custom_auth: secret },
    };
    const result = await provider.instances.create(options);
    const body = JSON.parse(String(fetch.mock.calls[0][1].body));
    expect(body.authorization).toBe(secret);
    expect(body.custom).toEqual({ token: secret });
    expect(body.containers[0].environment).toEqual({ TOKEN: secret });
    expect(body.containers[0].custom_auth).toBe(secret);
    expect(JSON.stringify(result.sizing)).not.toContain(secret);
    expect(JSON.stringify(provider.sizes.list(options))).not.toContain(secret);
    expect(provider.sizes.resolve('sm', options)).toMatchObject({
      nativeOptions: { instanceOptions: { shape: { virtual_cpu: 1, memory_megabytes: 2048 } } },
    });
    expect(result.sizing).not.toHaveProperty('nativeOptions');
    expect(result.sizing!.resolved).not.toHaveProperty('nativeOptions');
    try {
      await provider.instances.create({ ...options, size: 'conflict' });
      throw new Error('expected preflight failure');
    } catch (error) {
      expect(JSON.stringify(error)).not.toContain(secret);
      expect(error).toMatchObject({ code: 'conflict' });
    }
    expect(options.metadata).toEqual({ token: secret });
    expect(Object.isFrozen(options.instanceOptions.shape)).toBe(false);
  });
});
