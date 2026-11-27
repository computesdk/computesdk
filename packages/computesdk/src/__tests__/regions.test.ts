import { afterEach, describe, expect, it, vi } from 'vitest';
import { compute, type DirectProvider } from '../compute';
import { defineProvider } from '../provider/factory';
import { createRegionManager, type RegionResolver } from '../provider/regions';
import { REGION_CLASSES, RegionError, type RegionClass } from '../regions';
import { platform } from '../router/provider';

const selectable: RegionResolver<unknown> = {
  support: () => ({ placement: 'selectable', regions: { 'us-east': ['iad1', 'cle1'], 'us-west': ['sfo1'] } }),
  nativeOptions: region => ({ region }),
};

function adapter(regions?: RegionResolver<Record<string, unknown>>) {
  const create = vi.fn(async (_config: unknown, options?: Record<string, unknown>) => ({ instance: { options }, instanceId: 'sb_1' }));
  const factory = defineProvider<any, Record<string, unknown>>({
    name: 'regional',
    ...(regions ? { regions } : {}),
    methods: {
      instances: {
        create: create as any,
        getById: vi.fn(async () => null),
        list: vi.fn(async () => []),
        destroy: vi.fn(async () => {}),
        runCommand: vi.fn(async () => ({ stdout: '', stderr: '', exitCode: 0, durationMs: 0 })),
        getInfo: vi.fn(async () => ({ id: 'sb_1', provider: 'regional', status: 'running', createdAt: new Date(), timeout: 0 })),
        getUrl: vi.fn(async () => ''),
      },
    },
  } as any);
  return { provider: factory({}), create };
}

describe('standard regions', () => {
  it('defines the four US areas plus broad us', () => {
    expect(REGION_CLASSES).toEqual(['us', 'us-east', 'us-central', 'us-south', 'us-west']);
    expect(Object.isFrozen(REGION_CLASSES)).toBe(true);
  });

  it('maps an area to the first declared id, and us to any declared id', () => {
    const manager = createRegionManager({}, selectable);
    expect(manager.resolve('us-east')).toMatchObject({ status: 'supported', region: 'iad1', nativeOptions: { region: 'iad1' } });
    expect(manager.resolve('us')).toMatchObject({ status: 'supported', region: 'iad1' });
    expect(manager.resolve('us-central')).toMatchObject({ status: 'unsupported' });
  });

  it('never matches an area request with a broad us-only declaration', () => {
    const manager = createRegionManager({}, { support: () => ({ placement: 'selectable', regions: { us: ['us'] } }), nativeOptions: r => ({ target: r }) });
    expect(manager.resolve('us')).toMatchObject({ status: 'supported', nativeOptions: { target: 'us' } });
    expect(manager.resolve('us-west')).toMatchObject({ status: 'unsupported' });
  });

  it('sends nothing for per-account and fixed placements, and rejects a mismatched area', () => {
    const manager = createRegionManager({}, { support: () => ({ placement: 'per-account', regions: { 'us-west': ['us-west-1'] } }) });
    expect(manager.resolve('us-west')).toMatchObject({ status: 'supported', placement: 'per-account', region: 'us-west-1', nativeOptions: {} });
    expect(manager.resolve('us-east')).toMatchObject({ status: 'unsupported' });
  });

  it('treats undeclared and provider-placed adapters as unknown', () => {
    expect(createRegionManager({}).resolve('us')).toMatchObject({ status: 'unknown', placement: 'unknown' });
    expect(createRegionManager({}, { support: () => ({ placement: 'provider-placed', regions: {} }) }).resolve('us')).toMatchObject({ status: 'unknown' });
  });

  it('applies the native region on create, strips regionClass and records the placement', async () => {
    const { provider, create } = adapter(selectable as RegionResolver<Record<string, unknown>>);
    const instance = await provider.instances.create({ regionClass: 'us-west' });
    expect(create.mock.calls[0][1]).toEqual({ region: 'sfo1' });
    expect(instance.regionPlacement).toEqual({ requested: 'us-west', placement: 'selectable', region: 'sfo1', provenance: 'adapter-declared' });
  });

  it('leaves create untouched without regionClass', async () => {
    const { provider, create } = adapter(selectable as RegionResolver<Record<string, unknown>>);
    const instance = await provider.instances.create({ name: 'n' });
    expect(create.mock.calls[0][1]).toEqual({ name: 'n' });
    expect(instance.regionPlacement).toBeUndefined();
  });

  it.each([
    ['unknown', undefined, { regionClass: 'us-west' }],
    ['unsupported', selectable, { regionClass: 'us-south' }],
    ['conflict', selectable, { regionClass: 'us-west', region: 'iad1' }],
    ['invalid', selectable, { regionClass: 'us-west-1' }],
  ] as const)('fails %s before create', async (code, regions, options) => {
    const { provider, create } = adapter(regions as RegionResolver<Record<string, unknown>> | undefined);
    await expect(provider.instances.create(options as never)).rejects.toMatchObject({ name: 'RegionError', code, fallback: false });
    expect(create).not.toHaveBeenCalled();
  });

  it('allows a native selector that matches the resolved id', async () => {
    const { provider, create } = adapter(selectable as RegionResolver<Record<string, unknown>>);
    await provider.instances.create({ regionClass: 'us-east', region: 'iad1' });
    expect(create.mock.calls[0][1]).toEqual({ region: 'iad1' });
  });

  it('pins the selected provider and does not fall back in compute', async () => {
    const legacy: DirectProvider = { name: 'legacy', sandbox: { create: vi.fn(), getById: vi.fn(), destroy: vi.fn() } };
    const next: DirectProvider = { name: 'next', sandbox: { create: vi.fn(), getById: vi.fn(), destroy: vi.fn() } };
    const client = compute({ providers: [legacy, next], fallbackOnError: true });
    await expect(client.instances.create({ regionClass: 'us-east' })).rejects.toBeInstanceOf(RegionError);
    expect(legacy.sandbox!.create).not.toHaveBeenCalled();
    expect(next.sandbox!.create).not.toHaveBeenCalled();
  });
});

describe('hosted platform regionClass', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  function stubFetch() {
    const fetcher = vi.fn(async (_url: string, _init?: RequestInit) => new Response(JSON.stringify({ sandbox: {
      id: 'sb_1', status: 'running', provider: 'vercel', region: null, label: null, size: 'small', createdAt: '2026-11-27T00:00:00Z', cost: {}, attach: null,
    } }), { headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetcher);
    return fetcher;
  }

  it('forwards regionClass in the create body', async () => {
    const fetcher = stubFetch();
    await platform({ apiKey: 'csdk_test' }).instances.create({ regionClass: 'us-west', size: 'small' } as never);
    expect(JSON.parse(fetcher.mock.calls[0][1]?.body as string)).toMatchObject({ regionClass: 'us-west', size: 'small' });
  });

  it('omits regionClass when not requested', async () => {
    const fetcher = stubFetch();
    await platform({ apiKey: 'csdk_test' }).instances.create({ size: 'small' } as never);
    expect(JSON.parse(fetcher.mock.calls[0][1]?.body as string)).not.toHaveProperty('regionClass');
  });

  it('rejects a non-standard regionClass before calling the platform', async () => {
    const fetcher = stubFetch();
    await expect(platform({ apiKey: 'csdk_test' }).instances.create({ regionClass: 'sfo1' as RegionClass } as never)).rejects.toMatchObject({ code: 'invalid' });
    expect(fetcher).not.toHaveBeenCalled();
  });
});
