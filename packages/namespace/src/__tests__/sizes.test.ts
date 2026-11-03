import { afterEach, describe, expect, it, vi } from 'vitest';
import { namespace } from '../index';

const profiles = [['sm', 1, 2048], ['md', 2, 4096], ['lg', 4, 8192], ['xl', 8, 16384]] as const;
function mockFetch() {
  const fetch = vi.fn(async () => ({ ok: true, json: async () => ({ metadata: { instanceId: 'new' }, extendedMetadata: { commandServiceEndpoint: 'https://cmd.invalid' } }) }));
  vi.stubGlobal('fetch', fetch);
  return fetch;
}

describe('Namespace standard size mapping (mock-only)', () => {
  afterEach(() => { vi.unstubAllGlobals(); });
  it('discovers sizes purely without credentials, files, or API calls', () => {
    const fetch = mockFetch();
    const sizes = namespace({ tokenFile: '/must-not-read' }).sizes;
    expect(sizes.list().filter(p => p.status === 'supported').map(p => p.requested.sizeClass)).toEqual(['sm', 'md', 'lg', 'xl']);
    expect(sizes.resolve('xs').status).toBe('unknown'); expect(sizes.resolve('2xl').status).toBe('unknown');
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each(profiles)('maps %s to exact native request and overrides only config defaults', async (sizeClass, cpu, memory) => {
    const fetch = mockFetch();
    const provider = namespace({ token: 'test', virtualCpu: 99, memoryMegabytes: 99999 });
    const options = { sizeClass, instanceOptions: { workload_permissions: [{ action: 'read' }], shape: { os: 'linux' } } };
    const result = await provider.instances.create(options);
    const body = JSON.parse((fetch.mock.calls as any[][])[0][1].body);
    expect(body.shape).toEqual({ os: 'linux', machine_arch: 'amd64', virtual_cpu: cpu, memory_megabytes: memory });
    expect(body.workload_permissions).toEqual([{ action: 'read' }]);
    expect(body).not.toHaveProperty('sizeClass');
    expect(result.sizing).toMatchObject({ requested: { sizeClass, vcpus: cpu, memoryMiB: memory }, resolved: { vcpus: cpu, memoryMiB: memory }, provenance: 'adapter-declared' });
    expect(options.instanceOptions.shape).toEqual({ os: 'linux' });
  });
  it.each([
    { sizeClass: 'sm', instanceOptions: { shape: { virtual_cpu: 1 } } },
    { sizeClass: 'sm', instanceOptions: { shape: { memory_megabytes: 2048 } } },
    { sizeClass: 'sm', instanceOptions: { shape: { virtualCpu: 1 } } },
    { sizeClass: 'sm', instanceOptions: { shape: { memoryMegabytes: 2048 } } },
    { sizeClass: 'sm', virtualCpu: 1 }, { sizeClass: 'sm', memoryMegabytes: 2048 },
    { sizeClass: 'sm', size: 'native' }, { sizeClass: 'wrong' }, { sizeClass: 'xs' },
  ])('rejects invalid, conflicting or unknown request without API call: %j', async options => {
    const fetch = mockFetch();
    await expect(namespace({ token: 'test' }).instances.create(options as any)).rejects.toMatchObject({ fallback: false });
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
    expect(JSON.parse((fetch.mock.calls as any[][])[0][1].body).shape).toEqual({
      virtual_cpu: 1, memory_megabytes: 2048, os: 'linux', machine_arch: 'amd64',
    });
  });
  it('pins the validated platform even if factory defaults change during credential await', async () => {
    const fetch = mockFetch();
    const config = { token: 'test', os: 'linux', machineArch: 'amd64' };
    const create = namespace(config).instances.create({ sizeClass: 'sm' });
    config.os = 'macos'; config.machineArch = 'arm64';
    await create;
    expect(JSON.parse((fetch.mock.calls as any[][])[0][1].body).shape).toMatchObject({ os: 'linux', machine_arch: 'amd64' });
  });
  it.each([null, [], 'invalid', 7])('rejects malformed native shape %j before credentials/API', async shape => {
    const fetch = mockFetch();
    await expect(namespace({ tokenFile: '/must-not-read' }).instances.create({ sizeClass: 'sm', instanceOptions: { shape } })).rejects.toMatchObject({ code: 'invalid' });
    expect(fetch).not.toHaveBeenCalled();
  });
  it('does not claim Linux profiles for macOS or unverified architectures', async () => {
    const fetch = mockFetch();
    for (const provider of [namespace({ os: 'macos' }), namespace({ machineArch: 'arm64' })]) {
      expect(provider.sizes.resolve('sm').status).toBe('unknown');
      await expect(provider.instances.create({ sizeClass: 'sm' })).rejects.toMatchObject({ code: 'unknown' });
    }
    const provider = namespace({ token: 'test' });
    await expect(provider.instances.create({ sizeClass: 'sm', instanceOptions: { shape: { os: 'macos' } } })).rejects.toMatchObject({ code: 'unknown' });
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
  ])('rejects %s before a platform context can diverge from its native request', async (_name, context) => {
    const fetch = mockFetch();
    const provider = namespace({ token: 'test' });
    // Preserve the original descriptor forms; spreading the test context would hide the bug.
    const options = Object.defineProperty(context, 'sizeClass', { value: 'sm', enumerable: true });
    await expect(provider.instances.create(options as any)).rejects.toMatchObject({ code: 'invalid' });
    expect(() => provider.sizes.resolve('sm', options as any)).toThrowError(/sizeClass/);
    expect(() => provider.sizes.list(options as any)).toThrowError(/sizeClass/);
    expect(fetch).not.toHaveBeenCalled();
  });
  it('preserves legacy per-create native shape and native size fields', async () => {
    const fetch = mockFetch();
    const result = await namespace({ token: 'test' }).instances.create({ size: 'native', instanceOptions: { shape: { virtual_cpu: 3, memory_megabytes: 3333 } } });
    expect(JSON.parse((fetch.mock.calls as any[][])[0][1].body).shape).toMatchObject({ virtual_cpu: 3, memory_megabytes: 3333 });
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
    const body = JSON.parse((fetch.mock.calls as any[][])[0][1].body);
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
