import { afterEach, describe, expect, it, vi } from 'vitest';
import { Arker, ArkerError, VM } from '@arker-ai/sdk';
import { arker } from '../index';

const live = !!process.env.ARKER_API_KEY;
const profiles = [['xs', 1, 1024], ['sm', 1, 2048], ['md', 2, 4096], ['lg', 4, 8192], ['xl', 8, 16384], ['2xl', 16, 32768]] as const;
const goldens = { xs: 'ubuntu-coding', sm: 'ubuntu-coding', md: 'ubuntu-coding', lg: 'ubuntu-coding', xl: 'ubuntu-coding-8', '2xl': 'ubuntu-coding-32' };

function mockFork(impl?: () => Promise<VM>) {
  return vi.spyOn(Arker.prototype, 'fork').mockImplementation(impl ?? (async () => ({ id: 'vm-new' }) as VM));
}
const config = { apiKey: 'ark_test', platforms: ['graviton4'] };

describe('Arker standard size mapping (mock)', () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it('discovers every standard size without API calls', () => {
    const fork = mockFork();
    expect(arker(config).sizes.list().filter(p => p.status === 'supported').map(p => p.requested.sizeClass))
      .toEqual(['xs', 'sm', 'md', 'lg', 'xl', '2xl']);
    expect(fork).not.toHaveBeenCalled();
  });

  it.each(profiles)('forks %s from the smallest fitting golden with exact resources', async (sizeClass, vcpu, memory) => {
    const fork = mockFork();
    const result = await arker(config).instances.create({ sizeClass, name: 'job' });
    expect(fork).toHaveBeenCalledWith({
      source_vm_name: goldens[sizeClass], name: 'job', platforms: ['graviton4'], resources: { vcpu, memory_mib: memory },
    });
    expect(result.sizing).toEqual({ requested: { sizeClass, vcpus: vcpu, memoryMiB: memory }, resolved: { vcpus: vcpu, memoryMiB: memory }, provenance: 'adapter-declared' });
  });

  it('sizes a pinned source, leaving bounds to Arker', async () => {
    const fork = mockFork();
    await arker({ ...config, source: 'my-base' }).instances.create({ sizeClass: 'md' });
    await arker(config).instances.create({ sizeClass: 'xl', templateId: 'ubuntu-full-8' });
    expect(fork.mock.calls[0][0]).toMatchObject({ source_vm_name: 'my-base', resources: { vcpu: 2, memory_mib: 4096 } });
    expect(fork.mock.calls[1][0]).toMatchObject({ source_vm_name: 'ubuntu-full-8', resources: { vcpu: 8, memory_mib: 16384 } });
  });

  it.each([
    [{ templateId: 'ubuntu-full-8' }, 'sm', 'unsupported'],
    [{ templateId: 'ubuntu-coding' }, 'xl', 'unsupported'],
    [{ snapshotId: 'vm-snap' }, 'md', 'unknown'],
    [{ resources: { vcpu: 2 } }, 'md', 'conflict'],
    [{ resources: { disk_mib: 40960 } }, 'md', 'conflict'],
  ] as const)('rejects %j at %s before any API call (%s)', async (options, sizeClass, code) => {
    const fork = mockFork();
    await expect(arker(config).instances.create({ sizeClass, ...options } as any)).rejects.toMatchObject({ code, fallback: false });
    expect(fork).not.toHaveBeenCalled();
  });

  it('maps an Arker resource-bounds rejection to an unsupported size error', async () => {
    mockFork(async () => { throw new ArkerError('invalid_request', 'resources.vcpu exceeds max_vcpus for this source', 400); });
    await expect(arker({ ...config, source: 'my-base' }).instances.create({ sizeClass: 'xl' }))
      .rejects.toMatchObject({ name: 'InstanceSizeError', code: 'unsupported', fallback: false });
  });

  it('leaves unsized creates unchanged', async () => {
    const fork = mockFork();
    const result = await arker(config).instances.create({ name: 'plain' });
    expect(fork.mock.calls[0][0]).toEqual({ source_vm_name: 'ubuntu-small', name: 'plain', platforms: ['graviton4'] });
    expect(result.sizing).toBeUndefined();
  });
});

describe.skipIf(!live)('Arker standard sizes (live)', () => {
  // The benchmarks pin graviton4; check every size boots at its shape there.
  const provider = arker({ platforms: ['graviton4'] });

  it.each(profiles)('boots %s at %i vCPU / %i MiB', async (sizeClass, vcpu, memory) => {
    const instance = await provider.instances.create({ sizeClass });
    try {
      const result = await instance.runCommand("nproc; awk '/MemTotal/ {print $2}' /proc/meminfo");
      expect(result.exitCode).toBe(0);
      const [nproc, memKiB] = result.stdout.trim().split('\n').map(Number);
      console.log(`arker ${sizeClass}: nproc=${nproc} MemTotal=${memKiB} KiB (requested ${vcpu} / ${memory} MiB)`);
      expect(nproc).toBe(vcpu);
      // The guest kernel reserves some memory; allow 15% under the request.
      expect(memKiB / 1024).toBeGreaterThan(memory * 0.85);
      expect(memKiB / 1024).toBeLessThanOrEqual(memory * 1.05);
    } finally {
      await instance.destroy();
    }
  }, 180_000);
});
