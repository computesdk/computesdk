import {
  RegionError, getRegionClass, regionIdsFor,
  type RegionClass, type RegionManager, type RegionResolution, type RegionSupport,
} from '../regions';

/** Provider-owned, synchronous and side-effect-free: no credential checks or API calls. */
export interface RegionResolver<TConfig> {
  /** Pass `regionClass` through to create for the provider's own router instead of resolving it here. */
  routed?: boolean;
  /** Where this config can place instances. */
  support(config: TConfig): RegionSupport;
  /** Native create options that place on `region`, one of the ids from `support`. Required for `selectable`. */
  nativeOptions?(region: string, config: TConfig): Readonly<Record<string, unknown>>;
}

const UNKNOWN: RegionSupport = Object.freeze({
  placement: 'unknown', regions: Object.freeze({}), reason: 'This adapter declares no region placement.',
});

export function createRegionManager<TConfig>(config: TConfig, resolver?: RegionResolver<TConfig>): RegionManager {
  const support = (): RegionSupport => resolver?.support(config) ?? UNKNOWN;
  const resolve = (regionClass: RegionClass): RegionResolution => {
    const requested = getRegionClass(regionClass);
    const declared = support();
    const base = { requested, provenance: 'adapter-declared' as const };
    if (declared.placement === 'unknown' || declared.placement === 'provider-placed') {
      return Object.freeze({
        ...base, status: 'unknown', placement: declared.placement,
        reason: declared.reason ?? `This provider does not say where instances run, so it cannot promise ${requested}.`,
      });
    }
    const [region] = regionIdsFor(declared, requested);
    if (region === undefined) {
      const where = Object.values(declared.regions).flat().join(', ') || 'no declared region';
      return Object.freeze({
        ...base, status: 'unsupported', placement: declared.placement,
        reason: declared.placement === 'selectable'
          ? `This provider has no region in ${requested} (it offers ${where}).`
          : `This config runs in ${where}, not ${requested}.`,
      });
    }
    let nativeOptions: Readonly<Record<string, unknown>> = {};
    if (declared.placement === 'selectable') {
      if (!resolver?.nativeOptions) throw new RegionError('invalid', 'a selectable adapter must declare nativeOptions');
      nativeOptions = Object.freeze({ ...resolver.nativeOptions(region, config) });
      if (Object.prototype.hasOwnProperty.call(nativeOptions, 'regionClass')) {
        throw new RegionError('conflict', 'resolver cannot emit SDK-only regionClass as a native option');
      }
    }
    return Object.freeze({ ...base, status: 'supported', placement: declared.placement, region, nativeOptions });
  };
  return Object.freeze({ contract: 'computesdk.regions.v1' as const, ...(resolver?.routed ? { routed: true } : {}), support, resolve });
}

/** Merge a region patch, refusing a caller's native selector that names a different place. */
export function applyRegionPatch<T extends Record<string, unknown>>(options: T, patch: Readonly<Record<string, unknown>>): T {
  for (const [key, value] of Object.entries(patch)) {
    const current = options[key];
    if (current !== undefined && JSON.stringify(current) !== JSON.stringify(value)) {
      throw new RegionError('conflict', `cannot combine regionClass with ${key}`);
    }
  }
  return { ...options, ...patch };
}
