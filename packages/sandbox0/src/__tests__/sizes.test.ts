import { InstanceSizeError } from '@computesdk/provider';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sandbox0 } from '../index';

// Sizing can fail by declaring the wrong CPU/RAM or disk, silently claiming a
// default for a supported, unsupported, or rejected request, losing memory on
// a template/snapshot claim, or accepting conflicting native CPU/RAM fields.
const { claim, clientCreated } = vi.hoisted(() => ({
  claim: vi.fn(),
  clientCreated: vi.fn(),
}));

vi.mock('sandbox0', () => ({
  APIError: class extends Error {},
  Client: class {
    readonly sandboxes = { claim };

    constructor() {
      clientCreated();
    }
  },
}));

const supported = [
  ['sm', 1, 2048],
  ['md', 2, 4096],
  ['lg', 4, 8192],
  ['xl', 8, 16384],
] as const;

describe('Sandbox0 standard sizes', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv('SANDBOX0_TEMPLATE', '');
    claim.mockResolvedValue({ id: 'sb_mock', status: 'running' });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('lists only the supported shapes without initializing the vendor client', () => {
    const sizes = sandbox0().sizes;

    expect(sizes.list().filter(({ status }) => status === 'supported').map(({ requested }) => requested.sizeClass))
      .toEqual(['xs', ...supported.map(([sizeClass]) => sizeClass)]);
    for (const [sizeClass, vcpus, memoryMiB] of supported) {
      expect(sizes.resolve(sizeClass)).toEqual({
        requested: { sizeClass, vcpus, memoryMiB },
        status: 'supported',
        nativeOptions: { memory: memoryMiB },
        resolved: { vcpus, memoryMiB },
        provenance: 'adapter-declared',
      });
    }
    expect(clientCreated).not.toHaveBeenCalled();
  });

  it.each(supported)('claims %s with its exact memory, ahead of a configured default', async (sizeClass, vcpus, memoryMiB) => {
    const instance = await sandbox0({ token: 'mock-token', memory: 256 }).sandbox.create({ sizeClass });

    expect(claim.mock.calls).toEqual([['coding-agent', { memory: memoryMiB + 'Mi' }]]);
    expect(instance.sizing?.resolved).toEqual({ vcpus, memoryMiB });
  });

  it('keeps the memory override on explicit template and snapshot claims', async () => {
    const provider = sandbox0({ token: 'mock-token', memory: '1Gi' });

    await provider.sandbox.create({ sizeClass: 'sm', templateId: 'custom-template' });
    await provider.sandbox.create({
      sizeClass: 'md', templateId: 'custom-template', snapshotId: 'snapshot_mock', envs: { TEST: 'yes' },
    });

    expect(claim.mock.calls).toEqual([
      ['custom-template', { memory: '2048Mi' }],
      ['custom-template', { memory: '4096Mi', snapshotId: 'snapshot_mock', config: { envVars: { TEST: 'yes' } } }],
    ]);
  });

  it('claims 2 GiB for xs so it gets a whole vCPU', async () => {
    const instance = await sandbox0({ token: 'mock-token' }).sandbox.create({ sizeClass: 'xs' });
    expect(claim.mock.calls).toEqual([['coding-agent', { memory: '2048Mi' }]]);
    expect(instance.sizing).toMatchObject({ requested: { sizeClass: 'xs', memoryMiB: 1024 }, resolved: { vcpus: 1, memoryMiB: 2048 } });
  });

  it.each([
    ['2xl', '16 GiB'],
    ['3xl', '16 GiB'],
  ] as const)('refuses %s before any vendor call', async (sizeClass, reason) => {
    const provider = sandbox0();
    const resolution = provider.sizes.resolve(sizeClass);

    expect(resolution).toMatchObject({ status: 'unsupported', reason: expect.stringContaining(reason) });
    await expect(provider.sandbox.create({ sizeClass })).rejects.toMatchObject({
      name: 'InstanceSizeError', code: 'unsupported', fallback: false, resolution,
    });
    expect(clientCreated).not.toHaveBeenCalled();
    expect(claim).not.toHaveBeenCalled();
  });

  it.each([
    { memory: 2048 },
    { cpu: 1 },
    { vcpus: 1 },
    { resources: { memory: '2Gi' } },
  ])('refuses a competing selector %j before claiming', async (nativeOptions) => {
    const provider = sandbox0();
    const options = { sizeClass: 'sm' as const, ...nativeOptions };

    expect(() => provider.sizes.resolve('sm', nativeOptions)).toThrow(InstanceSizeError);
    await expect(provider.sandbox.create(options)).rejects.toMatchObject({ code: 'conflict', fallback: false });
    expect(clientCreated).not.toHaveBeenCalled();
    expect(claim).not.toHaveBeenCalled();
  });

  it('does not retry a rejected claim with default resources', async () => {
    const failure = new Error('claim rejected');
    claim.mockRejectedValueOnce(failure);

    await expect(sandbox0({ token: 'mock-token' }).sandbox.create({ sizeClass: 'xl' })).rejects.toBe(failure);
    expect(claim.mock.calls).toEqual([['coding-agent', { memory: '16384Mi' }]]);
  });
});
