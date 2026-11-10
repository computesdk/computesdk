import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { compute } from 'computesdk';
import { mosaic } from '../index.js';

const config = { baseUrl: 'https://mosaic.example.test' };
const nativeSnapshots = [
  { id: 'snap-other', source_sandbox_id: 'sbx-other' },
  { id: 'snap-source', source_sandbox_id: 'sbx-source' },
  { id: 'snap-source-2', source_sandbox_id: 'sbx-source' },
  { id: 'snap-unknown' },
].map((snapshot) => ({
  ...snapshot,
  template: 'node-20',
  memory_mb: 4096,
  vcpu: 2,
  created_at_ns: 3_000_000,
}));

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    expect(String(input)).toBe(`${config.baseUrl}/v1/snapshots`);
    expect(init?.method).toBe('GET');
    return new Response(JSON.stringify({ snapshots: nativeSnapshots }), {
      headers: { 'content-type': 'application/json' },
    });
  }));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Mosaic snapshot source identity', () => {
  it('keeps provider-wide inventory and preserves only native source identities', async () => {
    const provider = mosaic(config);
    const snapshots = await provider.snapshot!.list();

    expect(provider.snapshot!.listScope).toBe('provider');
    expect(snapshots.map(({ id, instanceId }) => ({ id, instanceId }))).toEqual([
      { id: 'snap-other', instanceId: 'sbx-other' },
      { id: 'snap-source', instanceId: 'sbx-source' },
      { id: 'snap-source-2', instanceId: 'sbx-source' },
      { id: 'snap-unknown', instanceId: undefined },
    ]);
    expect(snapshots[3]).not.toHaveProperty('instanceId');
    expect(snapshots[1]).toMatchObject({
      provider: 'mosaic',
      createdAt: new Date(3),
      metadata: { template: 'node-20', memoryMb: 4096, vcpu: 2 },
    });
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it('preserves global inventory and source identity through ComputeSDK', async () => {
    const sdk = compute({ provider: mosaic(config) });

    expect(await sdk.snapshot.list()).toEqual([
      expect.objectContaining({ id: 'snap-other', instanceId: 'sbx-other' }),
      expect.objectContaining({ id: 'snap-source', instanceId: 'sbx-source' }),
      expect.objectContaining({ id: 'snap-source-2', instanceId: 'sbx-source' }),
      expect.objectContaining({ id: 'snap-unknown' }),
    ]);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it.each([
    { label: 'canonical', options: { instanceId: 'sbx-source' } },
    { label: 'legacy', options: { sandboxId: 'sbx-source' } },
    { label: 'canonical precedence', options: { instanceId: 'sbx-source', sandboxId: 'sbx-other' } },
  ])('supports $label filtering at the provider and ComputeSDK boundaries', async ({ options }) => {
    const provider = mosaic(config);
    const expected = [
      expect.objectContaining({ id: 'snap-source', instanceId: 'sbx-source' }),
      expect.objectContaining({ id: 'snap-source-2', instanceId: 'sbx-source' }),
    ];

    expect(await provider.snapshot!.list(options)).toEqual(expected);
    expect(await compute({ provider }).snapshot.list(options)).toEqual(expected);
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
  });

  it('applies a limit after source filtering without losing identity', async () => {
    const provider = mosaic(config);
    const options = { instanceId: 'sbx-source', limit: 1 };
    const expected = [expect.objectContaining({ id: 'snap-source', instanceId: 'sbx-source' })];

    expect(await provider.snapshot!.list(options)).toEqual(expected);
    expect(await compute({ provider }).snapshot.list(options)).toEqual(expected);
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
  });

  it('returns no snapshots for an unknown source rather than the global inventory', async () => {
    const provider = mosaic(config);

    expect(await provider.snapshot!.list({ instanceId: 'sbx-missing' })).toEqual([]);
    expect(await compute({ provider }).snapshot.list({ sandboxId: 'sbx-missing' })).toEqual([]);
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
  });
});
