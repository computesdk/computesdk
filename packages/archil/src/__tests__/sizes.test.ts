import { afterEach, describe, expect, it, vi } from 'vitest';
import { archil } from '../index';
import { adaptFetchMock } from './fetch-mock';

/*
 * Ways the Archil size mapping could fail:
 * 1. Wrong shape: a class maps to CPU/RAM other than its exact profile, or a
 *    class Archil cannot provide (3xl needs 128 GiB; Archil caps at 64 GiB) is
 *    reported supported.
 * 2. Silent default boot: the native fields never reach POST /api/sandboxes,
 *    so Archil boots its 1 vCPU / 2048 MiB default.
 * 3. Dropped field: vcpus reaches the body but memoryMiB does not (or the
 *    reverse), or the exec-override (`ephemeral: false`) path drops them.
 * 4. Conflict accepted: native vcpuCount/memSizeMiB (camel or snake case, top
 *    level or under `sandbox`) or generic cpu/memory fields silently win over
 *    or lose to sizeClass.
 * 5. Attach/fork/exec paths (sandboxId, instanceId, snapshotId, exec mode)
 *    claim a size they cannot apply, or make an API call before refusing.
 * 6. Unsupported classes fall back to a default size instead of rejecting
 *    with fallback=false.
 */

const supported = [
  ['xs', 1, 1024], ['sm', 1, 2048], ['md', 2, 4096], ['lg', 4, 8192], ['xl', 8, 16384], ['2xl', 16, 32768],
] as const;
function mockFetch() {
  const fetch = vi.fn(async () => new Response(JSON.stringify({ success: true, data: {
    sandbox_id: 'new', status: 'running', vcpu_count: 99, mem_size_mib: 99999,
    created_at: new Date().toISOString(), last_active_at: new Date().toISOString(),
  } }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
  vi.stubGlobal('fetch', adaptFetchMock(fetch));
  return fetch;
}
const config = { apiKey: 'test', region: 'aws-us-east-1', execution: 'persistent' as const };
const body = (fetch: ReturnType<typeof mockFetch>, call = 0) => JSON.parse((fetch.mock.calls as any[][])[call][1].body);

describe('Archil standard size mapping (mock-only, installed disk SDK)', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it('discovers persistent VM mappings without credentials or API calls', () => {
    const fetch = mockFetch();
    const list = archil({ execution: 'persistent' }).sizes.list();
    expect(list.filter(p => p.status === 'supported').map(p => p.requested.sizeClass)).toEqual(['xs', 'sm', 'md', 'lg', 'xl', '2xl']);
    const xxxl = list.find(p => p.requested.sizeClass === '3xl')!;
    expect(xxxl.status).toBe('unsupported');
    expect(xxxl).toMatchObject({ reason: expect.stringContaining('65536 MiB') });
    expect(archil().sizes.resolve('sm').status).toBe('supported');
    expect(archil({ execution: 'exec' }).sizes.resolve('sm').status).toBe('unavailable');
    expect(archil({ execution: 'exec' }).sizes.resolve('sm', { ephemeral: false }).status).toBe('supported');
    expect(archil({ execution: 'persistent' }).sizes.resolve('sm', { ephemeral: true }).status).toBe('unavailable');
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each(supported)('declares %s as its exact profile', (sizeClass, vcpus, memoryMiB) => {
    const resolution = archil(config).sizes.resolve(sizeClass);
    expect(resolution).toMatchObject({ status: 'supported', nativeOptions: { vcpus, memoryMiB }, resolved: { vcpus, memoryMiB } });
    expect(resolution).not.toHaveProperty('belowStandard');
    expect((resolution as any).resolved).not.toHaveProperty('diskMiB');
  });

  it.each(supported)('sends %s as exact vcpu_count/mem_size_mib on create', async (sizeClass, cpu, memory) => {
    const fetch = mockFetch();
    const result = await archil(config).instances.create({ sizeClass, name: 'job', image: 'ubuntu:26.04' });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(body(fetch)).toMatchObject({ name: 'job', base_image: 'ubuntu:26.04', vcpu_count: cpu, mem_size_mib: memory });
    expect(body(fetch)).not.toHaveProperty('sizeClass'); expect(body(fetch)).not.toHaveProperty('size_class');
    // The response reports different values on purpose: metadata is adapter-declared, not observed.
    expect(result.sizing).toEqual({ requested: { sizeClass, vcpus: cpu, memoryMiB: memory }, resolved: { vcpus: cpu, memoryMiB: memory }, provenance: 'adapter-declared' });
  });

  it('forwards the size on the ephemeral:false override of exec config', async () => {
    const fetch = mockFetch();
    await archil({ ...config, execution: 'exec' }).instances.create({ sizeClass: '2xl', ephemeral: false });
    expect(body(fetch)).toMatchObject({ vcpu_count: 16, mem_size_mib: 32768 });
  });

  it('refuses 3xl with unsupported and no API call', async () => {
    const fetch = mockFetch();
    await expect(archil(config).instances.create({ sizeClass: '3xl' })).rejects.toMatchObject({ code: 'unsupported', fallback: false });
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    { vcpus: 1 }, { memoryMiB: 2048 }, { cpu: 1 }, { memory: 2048 },
    { vcpuCount: 1 }, { memSizeMiB: 2048 }, { vcpu_count: 1 }, { mem_size_mib: 2048 },
    { sandbox: { vcpuCount: 1 } }, { sandbox: { memSizeMiB: 2048 } },
    { sandbox: { vcpu_count: 1 } }, { sandbox: { mem_size_mib: 2048 } },
  ])('rejects conflicting native CPU/RAM %j without any API call', async options => {
    const fetch = mockFetch();
    await expect(archil(config).instances.create({ sizeClass: 'sm', ...options } as any)).rejects.toMatchObject({ code: 'conflict', fallback: false });
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    [{ ephemeral: true }, 'unavailable'], [{ sandboxId: 'existing' }, 'unsupported'],
    [{ instanceId: 'existing' }, 'unsupported'], [{ snapshotId: 'fork' }, 'unsupported'],
    [{ sizeClass: 'invalid' }, 'invalid'],
  ] as const)('rejects exec/attach/fork/invalid %j without any API call', async (options, code) => {
    const fetch = mockFetch();
    await expect(archil(config).instances.create({ sizeClass: 'sm', ...options } as any)).rejects.toMatchObject({ code, fallback: false });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('preserves legacy native options without sizeClass', async () => {
    const fetch = mockFetch();
    const result = await archil(config).instances.create({ cpu: 3, memory: 3333, size: 'legacy' });
    expect(body(fetch)).toMatchObject({ vcpu_count: 3, mem_size_mib: 3333 });
    expect(result.sizing).toBeUndefined();
  });

  it.each([
    { vcpuCount: 32, memSizeMiB: 65536 },
    { vcpu_count: 32, mem_size_mib: 65536 },
    { cpus: 32, memoryMb: 65536 },
    { cpus: 32, memMiB: 65536 },
    { sandbox: { vcpuCount: 32, memSizeMiB: 65536 } },
  ])('preserves a native max shape without sizeClass: %j', async options => {
    const fetch = mockFetch();
    const result = await archil(config).instances.create(options);
    expect(body(fetch)).toMatchObject({ vcpu_count: 32, mem_size_mib: 65536 });
    expect(result.sizing).toBeUndefined();
  });
});
