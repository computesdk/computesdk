/**
 * Beam standard size mapping (mock-only; no API keys, no sandboxes booted).
 *
 * Ways the mapping could fail, each covered below:
 * - Wrong shape: a class maps to cpu/memory other than its exact profile
 *   (e.g. memory in GB instead of MiB, or 2xl/3xl swapped).
 * - Silent default boot: sizeClass is accepted but cpu/memory never reach
 *   the beam-js Sandbox config, so Beam boots its 1 CPU / 128 MiB default.
 * - Dropped field: the restore path (`snapshotId`) or attach (`sandboxId`)
 *   ignores cpu/memory, so it must refuse instead of claiming the size.
 * - Stale cache: a cached Sandbox stub built for one size is reused for
 *   another, booting the wrong shape.
 * - Conflict accepted: native `cpu`/`memory` (or core selectors like `size`)
 *   combined with sizeClass silently picks one of them.
 * - Over-claim: Shared-tier requests above its 8 vCPU / 16 GiB cap, or GPU /
 *   pool placement with unlisted limits, are reported as supported.
 * - Side effects: discovery or a refused create calls the vendor API.
 * - Leak: sizeClass is passed to beam-js, or sizing without sizeClass changes
 *   the native defaults.
 */
import beamClient, { Sandbox, type SandboxInstance } from '@beamcloud/beam-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { beam } from '../index';

const profiles = [
  ['xs', 1, 1024], ['sm', 1, 2048], ['md', 2, 4096], ['lg', 4, 8192],
  ['xl', 8, 16384], ['2xl', 16, 32768], ['3xl', 32, 65536],
] as const;

const credentials = { token: 'token', workspaceId: 'workspace' };

function mockBeam() {
  const configs: Record<string, unknown>[] = [];
  const create = vi.spyOn(Sandbox.prototype, 'create').mockImplementation(async function (this: Sandbox) {
    configs.push({ ...(this as unknown as { stub: { config: Record<string, unknown> } }).stub.config });
    return { containerId: `sandbox-${configs.length}` } as unknown as SandboxInstance;
  });
  const fromSnapshot = vi.spyOn(Sandbox, 'createFromSnapshot').mockResolvedValue({ containerId: 'restored' } as unknown as SandboxInstance);
  const request = vi.spyOn(beamClient, 'request').mockRejectedValue(new Error('no network in tests'));
  return { configs, create, fromSnapshot, request };
}

describe('Beam standard size mapping (mock-only)', () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it('lists every standard size as its exact profile without API calls', () => {
    const { create, request } = mockBeam();
    const list = beam({}).sizes.list();
    expect(list.map(r => [r.requested.sizeClass, r.status])).toEqual(profiles.map(([c]) => [c, 'supported']));
    for (const [sizeClass, cpu, memory] of profiles) {
      expect(beam({}).sizes.resolve(sizeClass)).toMatchObject({
        status: 'supported', nativeOptions: { cpu, memory }, resolved: { vcpus: cpu, memoryMiB: memory }, provenance: 'adapter-declared',
      });
    }
    expect(create).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
  });

  it.each(profiles)('forwards %s as cpu=%d memory=%d MiB to the beam-js Sandbox', async (sizeClass, cpu, memory) => {
    const { configs } = mockBeam();
    const sandbox = await beam(credentials).instances.create({ sizeClass, envs: { A: '1' } });
    expect(configs).toHaveLength(1);
    expect(configs[0]).toMatchObject({ cpu, memory, env: { A: '1' } });
    expect(configs[0]).not.toHaveProperty('sizeClass');
    expect(sandbox.sizing).toMatchObject({ requested: { sizeClass, vcpus: cpu, memoryMiB: memory }, resolved: { vcpus: cpu, memoryMiB: memory } });
  });

  it('builds a separate Sandbox stub per size instead of reusing a cached one', async () => {
    const { configs } = mockBeam();
    const provider = beam(credentials);
    await provider.instances.create({ sizeClass: 'sm' });
    await provider.instances.create({ sizeClass: 'lg' });
    expect(configs.map(c => [c.cpu, c.memory])).toEqual([[1, 2048], [4, 8192]]);
  });

  it('leaves Beam defaults alone without sizeClass', async () => {
    const { configs } = mockBeam();
    await beam(credentials).instances.create({});
    expect(configs[0]).toMatchObject({ cpu: 1, memory: 128 });
  });

  it.each([
    { sizeClass: 'md', cpu: 2 }, { sizeClass: 'md', memory: 4096 }, { sizeClass: 'md', memory: '4Gi' },
    { sizeClass: 'md', size: 'large' }, { sizeClass: 'md', resources: { cpu: 2 } }, { sizeClass: 'huge' },
  ])('rejects conflicting or invalid request %j before any vendor call', async options => {
    const { create, request } = mockBeam();
    await expect(beam(credentials).instances.create(options as any)).rejects.toMatchObject({ name: 'InstanceSizeError', fallback: false });
    expect(create).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
  });

  it('reports native cpu/memory conflicts from discovery as conflict', () => {
    expect(() => beam({}).sizes.resolve('md', { cpu: 2 } as any)).toThrow(expect.objectContaining({ code: 'conflict' }));
  });

  it.each([{ snapshotId: 'chk-1' }, { sandboxId: 'sb-1' }])('refuses %j because restore/attach drops cpu/memory', async extra => {
    const { create, fromSnapshot } = mockBeam();
    await expect(beam(credentials).instances.create({ sizeClass: 'md', ...extra })).rejects.toMatchObject({ code: 'unsupported' });
    expect(fromSnapshot).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it('caps the Shared CPU tier at 8 vCPU / 16 GiB', async () => {
    const { configs } = mockBeam();
    const provider = beam(credentials);
    expect(provider.sizes.list({ cpuTier: 'shared' } as any).filter(r => r.status === 'supported').map(r => r.requested.sizeClass))
      .toEqual(['xs', 'sm', 'md', 'lg', 'xl']);
    await expect(provider.instances.create({ sizeClass: '2xl', cpuTier: 'shared' } as any)).rejects.toMatchObject({ code: 'unsupported' });
    await provider.instances.create({ sizeClass: 'xl', cpuTier: 'shared' } as any);
    expect(configs[0]).toMatchObject({ cpu: 8, memory: 16384 });
  });

  it.each([{ gpu: 'A10G' }, { gpuCount: 1 }, { pool: 'private' }])('does not claim sizes for GPU/pool placement %j', async extra => {
    const { create } = mockBeam();
    await expect(beam(credentials).instances.create({ sizeClass: 'md', ...extra } as any)).rejects.toMatchObject({ code: 'unknown' });
    expect(create).not.toHaveBeenCalled();
  });
});
