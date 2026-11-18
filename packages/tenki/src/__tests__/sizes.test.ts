/**
 * Mock-only tests for the Luxor (Tenki) standard size mapping.
 *
 * Ways the mapping could fail, each covered below:
 * 1. Wrong shape: a class maps to CPU/RAM other than its exact profile, or a
 *    shape below the profile (e.g. 3xl sent with 64 GiB instead of 128 GiB).
 * 2. Silent default boot: a sizeClass request reaches createAndWait without
 *    cpuCores/memoryMb, so Luxor boots its 2 vCPU / 4096 MB default.
 * 3. Dropped field: toCreateOptions drops cpuCores, memoryMb or diskSizeGb,
 *    including on the templateId (image) branch.
 * 4. Config defaults win: provider-level cpuCores/memoryMb/diskSizeGb override
 *    the requested size.
 * 5. Disk drift: sm/md/lg/xl send a root disk other than the platform presets
 *    (5/10/20/40 GiB), or resolved.diskMiB disagrees with what is sent.
 * 6. Conflict accepted: sizeClass combined with native cpuCores or memoryMb
 *    boots anyway instead of throwing InstanceSizeError('conflict').
 * 7. Unverified path claimed: a snapshotId restore (memory resume) is reported
 *    supported although Luxor does not document resizing a restore.
 * 8. sizeClass leaks to the vendor, or discovery calls the vendor API.
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';

const createCalls: any[] = [];

class FakeSession {
  id = 'sbx_sizes';
  state = 'RUNNING';
  timeoutAt = new Date(Date.now() + 3_600_000);
}

class FakeLuxorSandbox {
  constructor(public options: any) {}
  async createAndWait(opts: any) {
    createCalls.push(opts);
    return new FakeSession();
  }
}

vi.mock('@luxorai/sandbox', () => ({
  LuxorSandbox: FakeLuxorSandbox,
  Session: class {},
  SessionNotFoundError: class extends Error {},
  stdoutText: () => '',
  stderrText: () => '',
}));

let luxor: typeof import('../index').luxor;
beforeAll(async () => {
  ({ luxor } = await import('../index'));
});
beforeEach(() => {
  createCalls.length = 0;
});

const shapes = [
  ['xs', 1, 1024, undefined],
  ['sm', 1, 2048, 5],
  ['md', 2, 4096, 10],
  ['lg', 4, 8192, 20],
  ['xl', 8, 16384, 40],
  ['2xl', 16, 32768, undefined],
  ['3xl', 32, 131072, undefined],
] as const;

describe('Luxor standard sizes (mock-only)', () => {
  it('lists every standard size as supported without calling the vendor', () => {
    const sizes = luxor({}).sizes;
    expect(sizes.list().map((r) => [r.requested.sizeClass, r.status])).toEqual(
      shapes.map(([c]) => [c, 'supported']),
    );
    expect(createCalls).toHaveLength(0);
  });

  it.each(shapes)('%s sends exactly %i vCPU / %i MiB and the platform disk', async (sizeClass, cpu, mem, diskGb) => {
    const provider = luxor({ apiKey: 'lx_test', cpuCores: 99, memoryMb: 99998 });
    const resolution = provider.sizes.resolve(sizeClass);
    expect(resolution).toMatchObject({
      status: 'supported',
      nativeOptions: { cpuCores: cpu, memoryMb: mem, ...(diskGb ? { diskSizeGb: diskGb } : {}) },
      resolved: { vcpus: cpu, memoryMiB: mem, ...(diskGb ? { diskMiB: diskGb * 1024 } : {}) },
    });
    if (!diskGb && resolution.status === 'supported') {
      expect(resolution.nativeOptions).not.toHaveProperty('diskSizeGb');
      expect(resolution.resolved).not.toHaveProperty('diskMiB');
    }

    const sandbox = await provider.instances.create({ sizeClass });
    expect(createCalls).toHaveLength(1);
    const sent = createCalls[0];
    expect(sent.cpuCores).toBe(cpu);
    expect(sent.memoryMb).toBe(mem);
    expect(sent.diskSizeGb).toBe(diskGb);
    expect(sent).not.toHaveProperty('sizeClass');
    expect(sandbox.sizing).toMatchObject({ requested: { sizeClass, vcpus: cpu, memoryMiB: mem }, provenance: 'adapter-declared' });
  });

  it('size disk overrides the config disk default; config disk is reported where the size sets none', async () => {
    const provider = luxor({ apiKey: 'lx_test', diskSizeGb: 50 });
    await provider.instances.create({ sizeClass: 'lg' });
    expect(createCalls[0].diskSizeGb).toBe(20);
    await provider.instances.create({ sizeClass: '3xl' });
    expect(createCalls[1].diskSizeGb).toBe(50);
    expect(provider.sizes.resolve('3xl')).toMatchObject({ resolved: { vcpus: 32, memoryMiB: 131072, diskMiB: 51200 } });
  });

  it('a per-create diskSizeGb wins and is reported in resolved', async () => {
    const provider = luxor({ apiKey: 'lx_test' });
    const sandbox = await provider.instances.create({ sizeClass: 'md', diskSizeGb: 30 } as any);
    expect(createCalls[0]).toMatchObject({ cpuCores: 2, memoryMb: 4096, diskSizeGb: 30 });
    expect(sandbox.sizing?.resolved).toEqual({ vcpus: 2, memoryMiB: 4096, diskMiB: 30720 });
    await expect(provider.instances.create({ sizeClass: 'md', diskSizeGb: '30' } as any)).rejects.toMatchObject({ code: 'invalid' });
  });

  it('forwards the size on the templateId (image) branch', async () => {
    await luxor({ apiKey: 'lx_test' }).instances.create({ sizeClass: 'xl', templateId: 'registry/img:1' });
    expect(createCalls[0]).toMatchObject({ image: 'registry/img:1', cpuCores: 8, memoryMb: 16384, diskSizeGb: 40 });
  });

  it.each([
    [{ sizeClass: 'md', cpuCores: 2 }, 'conflict'],
    [{ sizeClass: 'md', memoryMb: 4096 }, 'conflict'],
    [{ sizeClass: 'md', snapshotId: 'snap_1' }, 'unknown'],
    [{ sizeClass: '4xl' }, 'invalid'],
  ])('refuses %j with %s and never boots', async (options, code) => {
    await expect(luxor({ apiKey: 'lx_test' }).instances.create(options as any)).rejects.toMatchObject({
      name: 'InstanceSizeError', code, fallback: false,
    });
    expect(createCalls).toHaveLength(0);
  });

  it('leaves creates without sizeClass on native options', async () => {
    await luxor({ apiKey: 'lx_test', cpuCores: 3, memoryMb: 6144 }).instances.create({ cpuCores: 6 } as any);
    expect(createCalls[0]).toMatchObject({ cpuCores: 6, memoryMb: 6144 });
    expect(createCalls[0].diskSizeGb).toBeUndefined();
  });
});
