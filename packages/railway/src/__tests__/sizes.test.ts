/**
 * Ways the Railway standard-size mapping could fail (all vendor calls mocked):
 * - Wrong shape: memory sent as MiB/1024 (GiB) instead of decimal GB, so the VM
 *   gets ~7% less RAM than the profile; vCPU not the profile's count.
 * - Silent default boot: a sized create goes through `Sandbox.create`, which in
 *   SDK 3.3.1 drops `resources`, so the workspace default size boots instead.
 * - Dropped field: a checkpoint restore (`snapshotId`) or env/timeout/network
 *   options lose the size, or the size drops them.
 * - Conflict accepted: `sizeClass` combined with native `resources` (or `cpu`)
 *   picks one silently instead of throwing InstanceSizeError('conflict').
 * - Unsupported accepted: 2xl/3xl exceed the listed 24 vCPU / 24 GB maximum but
 *   still create a sandbox (or fall back to a smaller one).
 * - Discovery side effects: `sizes.list()` needing credentials or calling the API.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { railway } from '../index';

const { create, connect } = vi.hoisted(() => ({ create: vi.fn(), connect: vi.fn() }));
vi.mock('railway', async (importOriginal) => {
  const actual = await importOriginal<typeof import('railway')>();
  return { ...actual, Sandbox: { create, connect } };
});

const fetchMock = vi.fn();
const client = { token: 'test-token', environmentId: 'test-environment' };
const sandbox = { id: 'test-sandbox', status: 'RUNNING' };
const requestedInput = () => JSON.parse(fetchMock.mock.calls[0][1].body).variables.input;

describe('Railway standard sizes (mock-only)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', fetchMock);
    create.mockResolvedValue(sandbox);
    connect.mockResolvedValue(sandbox);
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ data: { sandboxCreate: sandbox } })));
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('discovers sizes without credentials or API calls', () => {
    const sizes = railway({}).sizes;
    const list = sizes.list();
    expect(list.filter((r) => r.status === 'supported').map((r) => r.requested.sizeClass))
      .toEqual(['xs', 'sm', 'md', 'lg', 'xl']);
    for (const sizeClass of ['2xl', '3xl'] as const) {
      const resolution = sizes.resolve(sizeClass);
      expect(resolution.status).toBe('unsupported');
      expect(resolution).toMatchObject({ reason: expect.stringContaining('24 vCPU / 24 GB') });
    }
    expect(fetchMock).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it.each([
    ['xs', 1, 1024, 1.073741824], ['sm', 1, 2048, 2.147483648], ['md', 2, 4096, 4.294967296],
    ['lg', 4, 8192, 8.589934592], ['xl', 8, 16384, 17.179869184],
  ] as const)('maps %s to resources { cpu: %i } at %i MiB as decimal GB', async (sizeClass, cpu, memoryMiB, memoryGB) => {
    expect(railway(client).sizes.resolve(sizeClass)).toMatchObject({
      status: 'supported', resolved: { vcpus: cpu, memoryMiB }, nativeOptions: { resources: { cpu, memoryGB } },
    });
    const result = await railway(client).instances.create({ sizeClass });
    expect(requestedInput()).toEqual({ environmentId: client.environmentId, resources: { cpu, memoryGB } });
    expect(create).not.toHaveBeenCalled();
    expect(result.sizing).toEqual({
      requested: { sizeClass, vcpus: cpu, memoryMiB }, resolved: { vcpus: cpu, memoryMiB }, provenance: 'adapter-declared',
    });
  });

  it('keeps the size on checkpoint restores and keeps other create options', async () => {
    await railway(client).instances.create({
      sizeClass: 'md', snapshotId: 'checkpoint-name', envs: { A: '1' }, idleTimeoutMinutes: 3, networkIsolation: 'ISOLATED',
    });
    expect(requestedInput()).toEqual({
      environmentId: client.environmentId, template: { name: 'checkpoint-name' },
      resources: { cpu: 2, memoryGB: 4.294967296 }, variables: { A: '1' },
      idleTimeoutMinutes: 3, networkIsolation: 'ISOLATED',
    });
    expect(create).not.toHaveBeenCalled();
  });

  it.each([
    { resources: { cpu: 2 } }, { resources: { memoryGB: 4 } }, { resources: {} }, { cpu: 2 }, { memory: 4096 },
  ])('rejects sizeClass combined with native sizing %j before creating anything', async (native) => {
    await expect(railway(client).instances.create({ sizeClass: 'md', ...native }))
      .rejects.toMatchObject({ name: 'InstanceSizeError', code: 'conflict' });
    expect(() => railway(client).sizes.resolve('md', native)).toThrow(/conflict|cannot combine/);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it.each(['2xl', '3xl'] as const)('refuses %s without creating a sandbox', async (sizeClass) => {
    await expect(railway(client).instances.create({ sizeClass }))
      .rejects.toMatchObject({ name: 'InstanceSizeError', code: 'unsupported', fallback: false });
    await expect(railway(client).instances.create({ sizeClass, snapshotId: 'checkpoint-name' }))
      .rejects.toMatchObject({ code: 'unsupported' });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
    expect(connect).not.toHaveBeenCalled();
  });

  it('leaves unsized creates on the SDK default path', async () => {
    await railway(client).instances.create({ sizeClass: undefined, envs: { A: '1' } });
    expect(create).toHaveBeenCalledWith({ ...client, env: { A: '1' } });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
