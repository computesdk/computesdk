/**
 * Failure cases: SDK 3.3.1 drops native resource options; checkpoint restores
 * must retain the requested resources; decimal GB must not become GiB;
 * NaN/Infinity serialize to null (a vendor default); vendor refusals must not
 * fall back to a default-sized sandbox. All vendor calls are mocked.
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

describe('Railway native resources (mock-only)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', fetchMock);
    create.mockResolvedValue(sandbox);
    connect.mockResolvedValue(sandbox);
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ data: { sandboxCreate: sandbox } })));
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  it.each([
    [1, 2.147483648], [2, 4.294967296], [4, 8.589934592],
    [8, 17.179869184], [16, 34.359738368], [32, 137.438953472],
  ])('passes %i vCPUs and %s decimal GB exactly to the API', async (cpu, memoryGB) => {
    await railway(client).instances.create({ resources: { cpu, memoryGB } });
    expect(requestedInput()).toEqual({ environmentId: client.environmentId, resources: { cpu, memoryGB } });
    expect(create).not.toHaveBeenCalled();
    expect(connect).toHaveBeenCalledWith(sandbox.id, client);
  });

  it.each([{ cpu: 0.5 }, { memoryGB: 1 }, {}])('preserves partial native resource requests: %j', async (resources) => {
    await railway(client).instances.create({ resources });
    expect(requestedInput().resources).toEqual(resources);
  });

  it('preserves snapshot, environment, timeout and network with explicit sizing', async () => {
    await railway(client).instances.create({
      snapshotId: 'checkpoint-name', resources: { cpu: 2, memoryGB: 4.294967296 },
      envs: { A: '1' }, idleTimeoutMinutes: 3, networkIsolation: 'ISOLATED',
    });
    expect(requestedInput()).toEqual({
      environmentId: client.environmentId, template: { name: 'checkpoint-name' },
      resources: { cpu: 2, memoryGB: 4.294967296 }, variables: { A: '1' },
      idleTimeoutMinutes: 3, networkIsolation: 'ISOLATED',
    });
  });

  it('keeps the SDK path when resources are omitted', async () => {
    await railway(client).instances.create({ envs: { A: '1' } });
    expect(create).toHaveBeenCalledWith({ ...client, env: { A: '1' } });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each(['cpu', 'memoryGB'] as const)('rejects invalid %s before creating anything', async (key) => {
    for (const value of [0, -1, NaN, Infinity, -Infinity, null, '2']) {
      await expect(railway(client).instances.create({ resources: { [key]: value } }))
        .rejects.toThrow(new RegExp(`resources\\.${key}.*positive finite number`));
    }
    expect(fetchMock).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it('surfaces a plan refusal without retrying at the default size', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ errors: [{ message: 'resources exceed workspace VM maximum' }] })));
    await expect(railway(client).instances.create({ resources: { cpu: 32, memoryGB: 137.438953472 } }))
      .rejects.toThrow('resources exceed workspace VM maximum');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(create).not.toHaveBeenCalled();
    expect(connect).not.toHaveBeenCalled();
  });
});
