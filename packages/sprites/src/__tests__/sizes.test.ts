import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { INSTANCE_SIZE_PROFILES, InstanceSizeError, type InstanceSizeClass } from 'computesdk';
import { sprites } from '../index';

// Sprites have one fixed shape (8 vCPUs, platform-managed memory, 100 GB)
// and POST /v1/sprites has no CPU/RAM/disk fields. Ways the mapping could fail:
// - wrong shape: some class resolves 'supported' and claims a size Sprites can't pick;
// - silent default boot: create({ sizeClass }) reaches POST /v1/sprites and
//   boots the fixed shape labelled as the requested size;
// - dropped/leaked field: sizeClass (or a size patch) is spread into the
//   create body, which the API ignores;
// - conflict accepted: generic native CPU/RAM fields next to sizeClass are
//   accepted instead of rejected with 'conflict';
// - wrong status: 'unknown' instead of 'unsupported', or no reason given;
// - regression: a create without sizeClass stops working.
const CLASSES = Object.keys(INSTANCE_SIZE_PROFILES) as InstanceSizeClass[];

describe('sprites standard sizes', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ id: 'sprite-1', name: 'sprite-1', status: 'cold' }), { status: 201 }));
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('declares the sizing contract and lists every standard class', () => {
    const provider = sprites({ apiKey: 'test' });
    expect(provider.sizes.contract).toBe('computesdk.instance-sizes.v1');
    expect(provider.sizes.list().map(r => r.requested.sizeClass)).toEqual(CLASSES);
  });

  it.each(CLASSES)('resolves %s as unsupported with the fixed-shape reason', sizeClass => {
    const resolution = sprites({ apiKey: 'test' }).sizes.resolve(sizeClass);
    expect(resolution.status).toBe('unsupported');
    expect(resolution).not.toHaveProperty('nativeOptions');
    expect(resolution).not.toHaveProperty('resolved');
    expect((resolution as { reason: string }).reason).toMatch(/fixed shape.*8 vCPUs.*no CPU, memory or disk fields/);
  });

  it.each(CLASSES)('refuses create({ sizeClass: %s }) without calling the API', async sizeClass => {
    const error = await sprites({ apiKey: 'test' }).sandbox.create({ sizeClass }).catch(e => e);
    expect(error).toBeInstanceOf(InstanceSizeError);
    expect(error.code).toBe('unsupported');
    expect(error.fallback).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([{ cpu: 8 }, { memory: 16384 }, { vcpus: 8, memoryMiB: 16384 }])(
    'rejects sizeClass combined with native resources %j as a conflict', async native => {
      const error = await sprites({ apiKey: 'test' }).sandbox.create({ sizeClass: 'xl', ...native }).catch(e => e);
      expect(error).toBeInstanceOf(InstanceSizeError);
      expect(error.code).toBe('conflict');
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it('still creates without sizeClass and sends no sizing fields', async () => {
    const sandbox = await sprites({ apiKey: 'test' }).sandbox.create({ name: 'plain' });
    expect(sandbox.sizing).toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.sprites.dev/v1/sprites');
    const body = JSON.parse(init.body);
    expect(body).toEqual({ name: 'plain', url_settings: { auth: 'public' } });
  });

  it('treats sizeClass: undefined as no request', async () => {
    await sprites({ apiKey: 'test' }).sandbox.create({ name: 'plain', sizeClass: undefined });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).not.toHaveProperty('sizeClass');
  });
});
