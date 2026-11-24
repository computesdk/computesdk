import { describe, expect, it } from 'vitest';
import { groundbox } from '../index';
import { fakeApi, sandbox } from './fake-api';

/** The standard sizes that were booted and measured, as [sizeClass, vCPUs, memory in MiB]. */
const SIZES = [
  ['xs', 1, 1024],
  ['sm', 1, 2048],
  ['md', 2, 4096],
  ['lg', 4, 8192],
  ['xl', 8, 16384],
] as const;

describe('groundbox standard sizes', () => {
  it('lists what it supports without a key or an API call', () => {
    const api = fakeApi({});
    const sizes = groundbox({ fetch: api.fetch }).sizes.list();
    expect(sizes.filter((size) => size.status === 'supported').map((size) => size.requested.sizeClass)).toEqual(SIZES.map(([name]) => name));
    expect(sizes.find((size) => size.requested.sizeClass === '2xl')).toMatchObject({ status: 'unknown' });
    expect(api.calls).toEqual([]);
  });

  it('does not support 3xl: Groundbox sandboxes have at most 16 vCPUs', async () => {
    const api = fakeApi({ 'POST /sandboxes': sandbox() });
    const provider = groundbox({ apiKey: 'gbx_test', fetch: api.fetch });
    expect(provider.sizes.list().find((size) => size.requested.sizeClass === '3xl')).toMatchObject({ status: 'unsupported' });
    await expect(provider.instances.create({ sizeClass: '3xl' })).rejects.toMatchObject({ name: 'InstanceSizeError', code: 'unsupported' });
    expect(api.calls).toEqual([]);
  });

  it('does not map 2xl, which has not been booted and checked, and makes no request for it', async () => {
    const api = fakeApi({ 'POST /sandboxes': sandbox() });
    const provider = groundbox({ apiKey: 'gbx_test', fetch: api.fetch });
    await expect(provider.instances.create({ sizeClass: '2xl' })).rejects.toMatchObject({ name: 'InstanceSizeError', code: 'unknown' });
    expect(api.calls).toEqual([]);
    // The native fields still ask for it.
    await provider.instances.create({ cpus: 16, memory_gb: 32 });
    expect(api.last().body).toEqual({ cpus: 16, memory_gb: 32, user: 'root' });
  });

  it.each(SIZES)('asks for %s as exactly %i vCPU and %i MiB', async (sizeClass, vcpus, memoryMiB) => {
    const api = fakeApi({ 'POST /sandboxes': sandbox() });
    const provider = groundbox({ apiKey: 'gbx_test', fetch: api.fetch });
    expect(provider.sizes.resolve(sizeClass)).toMatchObject({ status: 'supported', nativeOptions: { cpus: vcpus, memory_gb: memoryMiB / 1024 } });

    const instance = await provider.instances.create({ sizeClass, timeout: 5 * 60_000 });
    expect(api.last().body).toEqual({ cpus: vcpus, memory_gb: memoryMiB / 1024, timeout_minutes: 5, user: 'root' });
    expect(instance.sizing).toEqual({ requested: { sizeClass, vcpus, memoryMiB }, resolved: { vcpus, memoryMiB }, provenance: 'adapter-declared' });
  });

  it.each([{ cpus: 2 }, { memory_gb: 4 }])('refuses sizeClass with %o', async (native) => {
    const api = fakeApi({ 'POST /sandboxes': sandbox() });
    const provider = groundbox({ apiKey: 'gbx_test', fetch: api.fetch });
    await expect(provider.instances.create({ sizeClass: 'md', ...native })).rejects.toMatchObject({ name: 'InstanceSizeError', code: 'conflict' });
    expect(api.calls).toEqual([]);
  });
});

/**
 * Live: boot each size and read it back from inside the VM. The same check as
 * `scripts/provider-setup.mjs --verify` (`nproc` and MemTotal, which reads a little
 * under the request because the guest kernel keeps some), plus the size the API
 * says the VM booted at, and any cgroup limit on the command's own cgroup.
 */
const CGROUP_LIMITS =
  `d=/sys/fs/cgroup$(awk -F: '$1 == 0 { print $3 }' /proc/self/cgroup); ` +
  `while :; do for f in cpu.max memory.max; do [ -r "$d/$f" ] && echo "$f $(cat "$d/$f")"; done; ` +
  `[ "$d" = /sys/fs/cgroup ] && break; d=$(dirname "$d"); done; true`;

describe.skipIf(!process.env.GROUNDBOX_API_KEY)('groundbox standard sizes (live)', () => {
  const provider = groundbox({ apiKey: process.env.GROUNDBOX_API_KEY });

  it.each(SIZES)('boots %s at %i vCPU and %i MiB', async (sizeClass, vcpus, memoryMiB) => {
    const instance = await provider.instances.create({ sizeClass, timeout: 5 * 60_000, metadata: { created_by: 'computesdk-conformance' } });
    try {
      const measured = await instance.runCommand("nproc; awk '/MemTotal/ { print int($2 / 1024) }' /proc/meminfo");
      expect(measured.exitCode).toBe(0);
      const [cpus, memTotalMiB] = measured.stdout.trim().split('\n').map(Number);

      // Limits on the command's cgroup and its parents: [cores, MiB], null where there is none.
      const limits = (await instance.runCommand(CGROUP_LIMITS)).stdout.trim().split('\n').filter(Boolean);
      const cpuLimits = limits.filter((line) => line.startsWith('cpu.max ') && !line.includes(' max ')).map((line) => Number(line.split(' ')[1]) / Number(line.split(' ')[2]));
      const memoryLimits = limits.filter((line) => line.startsWith('memory.max ') && !line.endsWith(' max')).map((line) => Number(line.split(' ')[1]) / 2 ** 20);
      const cgroupCpus = cpuLimits.length > 0 ? Math.min(...cpuLimits) : null;
      const cgroupMiB = memoryLimits.length > 0 ? Math.min(...memoryLimits) : null;

      const booted = (await instance.getInfo()).metadata?.groundbox?.booted;
      console.info(
        `[sizes] groundbox ${sizeClass}: want ${vcpus} vCPU / ${memoryMiB} MiB; nproc=${cpus} MemTotal=${memTotalMiB}MiB; ` +
          `API booted=${booted?.cpus} vCPU / ${booted?.memoryMiB} MiB; cgroup cpu.max=${cgroupCpus ?? 'none'} memory.max=${cgroupMiB ?? 'none'}`,
      );

      expect(cpus).toBe(vcpus);
      expect(memTotalMiB).toBeGreaterThanOrEqual(memoryMiB * 0.85);
      expect(memTotalMiB).toBeLessThanOrEqual(memoryMiB * 1.05);
      expect(booted).toEqual({ cpus: vcpus, memoryMiB: memTotalMiB });
      // A cgroup limit under the VM's size would make the size untrue for the commands run in it.
      if (cgroupCpus !== null) expect(cgroupCpus).toBeGreaterThanOrEqual(vcpus);
      if (cgroupMiB !== null) expect(cgroupMiB).toBeGreaterThanOrEqual(memTotalMiB);
    } finally {
      await instance.destroy();
    }
  }, 120_000);
});
