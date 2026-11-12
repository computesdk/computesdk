import { afterEach, describe, expect, it, vi } from 'vitest';
import { archil } from '../index';
import { adaptFetchMock } from './fetch-mock';

const profiles = [['sm', 1, 2048], ['md', 2, 4096], ['lg', 4, 8192], ['xl', 8, 16384]] as const;
function mockFetch() {
  const fetch = vi.fn(async () => new Response(JSON.stringify({ success: true, data: {
    sandbox_id: 'new', status: 'running', vcpu_count: 99, mem_size_mib: 99999,
    created_at: new Date().toISOString(), last_active_at: new Date().toISOString(),
  } }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
  vi.stubGlobal('fetch', adaptFetchMock(fetch));
  return fetch;
}
const config = { apiKey: 'test', region: 'aws-us-east-1', execution: 'persistent' as const };

describe('Archil standard size mapping (mock-only, installed disk SDK)', () => {
  afterEach(() => { vi.unstubAllGlobals(); });
  it('discovers only persistent VM mappings without credentials or API calls', () => {
    const fetch = mockFetch();
    expect(archil({ execution: 'persistent' }).sizes.list().filter(p => p.status === 'supported').map(p => p.requested.sizeClass)).toEqual(['sm', 'md', 'lg', 'xl']);
    expect(archil().sizes.resolve('sm').status).toBe('supported');
    expect(archil({ execution: 'exec' }).sizes.resolve('sm').status).toBe('unavailable');
    expect(archil({ execution: 'exec' }).sizes.resolve('sm', { ephemeral: false }).status).toBe('supported');
    expect(archil({ execution: 'persistent' }).sizes.resolve('sm', { ephemeral: true }).status).toBe('unavailable');
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each(profiles)('maps %s into exact native serialized CPU/RAM fields, without claiming observations', async (sizeClass, cpu, memory) => {
    const fetch = mockFetch();
    const result = await archil(config).instances.create({ sizeClass, name: 'job', image: 'ubuntu:26.04' });
    const body = JSON.parse((fetch.mock.calls as any[][])[0][1].body);
    expect(body).toMatchObject({ name: 'job', base_image: 'ubuntu:26.04', vcpu_count: cpu, mem_size_mib: memory });
    expect(body).not.toHaveProperty('sizeClass'); expect(body).not.toHaveProperty('size_class');
    // The response deliberately reports different values. Metadata describes only what was requested.
    expect(result.sizing).toEqual({ requested: { sizeClass, vcpus: cpu, memoryMiB: memory }, resolved: { vcpus: cpu, memoryMiB: memory }, provenance: 'adapter-declared' });
  });
  it.each([
    { ephemeral: true }, { sandboxId: 'existing' }, { instanceId: 'existing' }, { snapshotId: 'fork' },
    { vcpus: 1 }, { memoryMiB: 2048 }, { vcpuCount: 1 }, { sandbox: { memSizeMiB: 2048 } },
    { vcpu_count: 1 }, { sandbox: { mem_size_mib: 2048 } },
    { sizeClass: 'xs' }, { sizeClass: '2xl' }, { sizeClass: 'invalid' },
  ])('rejects exec/attach/fork/conflict/unverified request without any API: %j', async options => {
    const fetch = mockFetch();
    await expect(archil(config).instances.create({ sizeClass: 'sm', ...options } as any)).rejects.toMatchObject({ fallback: false });
    expect(fetch).not.toHaveBeenCalled();
  });
  it('honors explicit persistent override and preserves legacy native options', async () => {
    const fetch = mockFetch();
    await archil({ ...config, execution: 'exec' }).instances.create({ sizeClass: 'md', ephemeral: false });
    const result = await archil(config).instances.create({ cpu: 3, memory: 3333, size: 'legacy' });
    expect(JSON.parse((fetch.mock.calls as any[][])[1][1].body)).toMatchObject({ vcpu_count: 3, mem_size_mib: 3333 });
    expect(result.sizing).toBeUndefined();
  });
  it.each([
    { vcpuCount: 16, memSizeMiB: 32768 },
    { vcpu_count: 16, mem_size_mib: 32768 },
    { cpus: 16, memoryMb: 32768 },
    { cpus: 16, memMiB: 32768 },
    { sandbox: { vcpuCount: 16, memSizeMiB: 32768 } },
  ])('preserves a larger native shape without sizeClass: %j', async options => {
    const fetch = mockFetch();
    const result = await archil(config).instances.create(options);
    expect(JSON.parse((fetch.mock.calls as any[][])[0][1].body)).toMatchObject({
      vcpu_count: 16, mem_size_mib: 32768,
    });
    expect(result.sizing).toBeUndefined();
  });
});
