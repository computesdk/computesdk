/**
 * Cloudflare standard size mapping (mock; no Worker or API key).
 *
 * Ways the mapping could fail, each covered below:
 * - Wrong shape: a class boots a different vcpu/memoryMib than its profile, or a
 *   disk other than the platform preset (8192 / 12288 MB; lg at the 20000 MB cap).
 * - Over the limit: xl/2xl/3xl (past 4 vCPU / 12 GiB per instance) resolve as
 *   supported, or reach the Worker instead of failing before any request.
 * - Silent default boot: the Worker gets no vcpu/memoryMib/diskMb (it then
 *   starts `standard-1`), in remote, direct or snapshot-restore mode.
 * - Dropped field: one of the three is missing; the Worker rejects a partial set.
 * - Conflict accepted: sizeClass with native vcpu/memoryMib/diskMb boots instead
 *   of throwing InstanceSizeError('conflict').
 * - Reattach: sandboxId with sizeClass silently keeps the running instance's size.
 * - Regression: unsized creates gain sizing fields or `sizing` metadata.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cloudflare } from '../index.js';

const SANDBOX_ID = '0123456789abcdef'.repeat(4);
const BRIDGE_URL = 'https://bridge.example.com';

const supported = [
  ['xs', 1, 1024, 8192, 7812],
  ['sm', 1, 2048, 8192, 7812],
  ['md', 2, 4096, 12288, 11718],
  ['lg', 4, 8192, 20000, 19073],
] as const;

function bridgeFetch() {
  const calls: Array<{ method: string; path: string; body?: unknown }> = [];
  const fetchMock = vi.fn(async (input: string, init: RequestInit = {}) => {
    const url = new URL(input);
    const method = init.method ?? 'GET';
    calls.push({ method, path: url.pathname, body: init.body ? JSON.parse(init.body as string) : undefined });
    if (url.pathname === '/v1/info') {
      return Response.json({ bridge: 'computesdk', version: 1, features: ['exec-stream', 'files', 'ports', 'snapshots'] });
    }
    if (method === 'POST' && url.pathname === '/v1/sandbox') return Response.json({ id: SANDBOX_ID });
    return new Response('Not Found', { status: 404 });
  });
  vi.stubGlobal('fetch', fetchMock);
  const creates = () => calls.filter((call) => call.method === 'POST' && call.path === '/v1/sandbox');
  return { calls, creates, fetchMock };
}

const bridge = () => cloudflare({ sandboxUrl: BRIDGE_URL, sandboxApiKey: 'secret' });

function directBinding() {
  const stub = { start: vi.fn(async () => {}), exec: vi.fn(), destroy: vi.fn(async () => {}) };
  const binding = {
    newUniqueId: vi.fn(() => ({ toString: () => '0'.repeat(64) })),
    idFromString: vi.fn((id: string) => ({ toString: () => id })),
    get: vi.fn(() => stub),
  };
  return { binding, stub };
}

describe('Cloudflare standard sizes (mock)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('lists xs-lg as supported and refuses xl+ without any request', () => {
    const { fetchMock } = bridgeFetch();
    const list = bridge().sizes.list();
    expect(list.filter((r) => r.status === 'supported').map((r) => r.requested.sizeClass)).toEqual(['xs', 'sm', 'md', 'lg']);
    for (const r of list.filter((r) => r.status !== 'supported')) {
      expect(r).toMatchObject({ status: 'unsupported', reason: expect.stringContaining('4 vCPU / 12 GiB') });
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each(supported)('sends %s to the bridge as %i vCPU / %i MiB / %i MB', async (sizeClass, vcpu, memoryMib, diskMb, diskMiB) => {
    const { creates } = bridgeFetch();
    const instance = await bridge().instances.create({ sizeClass, image: 'builder' });
    expect(creates()).toHaveLength(1);
    expect(creates()[0].body).toEqual({ vcpu, memoryMib, diskMb, image: 'builder' });
    expect(instance.sizing).toEqual({
      requested: { sizeClass, vcpus: vcpu, memoryMiB: memoryMib },
      resolved: { vcpus: vcpu, memoryMiB: memoryMib, diskMiB },
      provenance: 'adapter-declared',
    });
  });

  it.each(supported)('passes %s to start() in direct mode', async (sizeClass, vcpu, memoryMib, diskMb) => {
    const { binding, stub } = directBinding();
    await cloudflare({ sandboxBinding: binding }).instances.create({ sizeClass });
    expect(stub.start).toHaveBeenCalledWith({ vcpu, memoryMib, diskMb });
  });

  it('keeps the size on a snapshot restore', async () => {
    const { creates } = bridgeFetch();
    await bridge().instances.create({ sizeClass: 'md', snapshotId: 'snap-1' });
    expect(creates()[0].body).toEqual({ vcpu: 2, memoryMib: 4096, diskMb: 12288, snapshotId: 'snap-1' });
  });

  it.each(['xl', '2xl', '3xl'] as const)('rejects %s before any request', async (sizeClass) => {
    const { fetchMock } = bridgeFetch();
    await expect(bridge().instances.create({ sizeClass })).rejects.toMatchObject({
      name: 'InstanceSizeError', code: 'unsupported', fallback: false,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([{ vcpu: 2 }, { memoryMib: 4096 }, { diskMb: 12288 }])('rejects sizeClass with native %j', async (native) => {
    const { fetchMock } = bridgeFetch();
    await expect(bridge().instances.create({ sizeClass: 'md', ...native })).rejects.toMatchObject({
      name: 'InstanceSizeError', code: 'conflict', fallback: false,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refuses sizeClass when reattaching with sandboxId', async () => {
    const { fetchMock } = bridgeFetch();
    const { binding, stub } = directBinding();
    await expect(bridge().instances.create({ sizeClass: 'md', sandboxId: SANDBOX_ID })).rejects.toMatchObject({ code: 'unsupported' });
    await expect(cloudflare({ sandboxBinding: binding }).instances.create({ sizeClass: 'md', sandboxId: SANDBOX_ID }))
      .rejects.toMatchObject({ code: 'unsupported' });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(stub.start).not.toHaveBeenCalled();
  });

  it('leaves unsized creates unchanged', async () => {
    const { creates } = bridgeFetch();
    const instance = await bridge().instances.create({ image: 'builder' });
    expect(creates()[0].body).toEqual({ image: 'builder' });
    expect(instance.sizing).toBeUndefined();
  });
});
