/** Standard US placement areas. `us` asks for anywhere in the United States. */
export type RegionClass = 'us' | 'us-east' | 'us-central' | 'us-south' | 'us-west';

export const REGION_CLASSES: readonly RegionClass[] = Object.freeze(['us', 'us-east', 'us-central', 'us-south', 'us-west']);

/**
 * How a provider decides where an instance runs.
 * - `selectable`: create chooses one of `regions` per instance.
 * - `per-account`: the credentials or endpoint fix the region; `regions` is where this config runs.
 * - `fixed`: the provider runs in one known place.
 * - `provider-placed`: the provider places it and does not promise where.
 * - `unknown`: not verified.
 */
export type RegionPlacementKind = 'selectable' | 'per-account' | 'fixed' | 'provider-placed' | 'unknown';

export type RegionErrorCode = 'invalid' | 'conflict' | 'unsupported' | 'unknown';

/** Adapter-declared placement for one provider config. Pure local data, never an availability check. */
export interface RegionSupport {
  readonly placement: RegionPlacementKind;
  /**
   * Provider region ids by standard region, preferred first. A `us` key only promises
   * somewhere in the US, so it serves a `us` request and never an area request.
   */
  readonly regions: Readonly<Partial<Record<RegionClass, readonly string[]>>>;
  readonly reason?: string;
}

export interface RegionPlacement {
  readonly requested: RegionClass;
  readonly placement: Exclude<RegionPlacementKind, 'provider-placed' | 'unknown'>;
  /** The provider's own region id the instance was placed in. */
  readonly region: string;
  readonly provenance: 'adapter-declared';
}

export type RegionResolution =
  | (RegionPlacement & { readonly status: 'supported'; readonly nativeOptions: Readonly<Record<string, unknown>> })
  | {
    readonly status: 'unsupported' | 'unknown';
    readonly requested: RegionClass;
    readonly placement: RegionPlacementKind;
    readonly reason: string;
    readonly provenance: 'adapter-declared';
  };

/** Pure local discovery. Never queries vendor APIs or validates credentials. */
export interface RegionManager {
  readonly contract: 'computesdk.regions.v1';
  /** The provider routes `regionClass` itself (the hosted platform); it is passed through, not resolved locally. */
  readonly routed?: boolean;
  support(): RegionSupport;
  resolve(regionClass: RegionClass): RegionResolution;
}

/** fallback=false: a region request never silently lands somewhere else. */
export class RegionError extends Error {
  readonly fallback = false;
  constructor(readonly code: RegionErrorCode, message: string, readonly resolution?: RegionResolution) {
    super(`regionClass: ${message}`);
    this.name = 'RegionError';
  }
}

export function isRegionClass(value: unknown): value is RegionClass {
  return typeof value === 'string' && (REGION_CLASSES as readonly string[]).includes(value);
}

export function getRegionClass(value: unknown): RegionClass {
  if (!isRegionClass(value)) {
    throw new RegionError('invalid', `invalid standard region (${typeof value === 'string' ? JSON.stringify(value) : typeof value}); expected one of ${REGION_CLASSES.join(', ')}`);
  }
  return value;
}

/** Provider ids that serve `requested`: every declared id for `us`, only that area's ids otherwise. */
export function regionIdsFor(support: RegionSupport, requested: RegionClass): string[] {
  const ids = requested === 'us'
    ? Object.values(support.regions).flatMap(list => list ?? [])
    : [...(support.regions[requested] ?? [])];
  return [...new Set(ids)];
}

export function isRegionManager(value: unknown): value is RegionManager {
  return value !== null && (typeof value === 'object' || typeof value === 'function') &&
    'contract' in value && value.contract === 'computesdk.regions.v1' &&
    'resolve' in value && typeof value.resolve === 'function' &&
    'support' in value && typeof value.support === 'function';
}

/** Guard custom/legacy providers too: a provider with no region contract must not ignore a request. */
export function assertRegionSupported(
  provider: { readonly name?: string; readonly regions?: unknown },
  options?: import('./types/universal-instance').CreateInstanceOptions,
): void {
  if (options?.regionClass === undefined) return;
  const regionClass = getRegionClass(options.regionClass);
  const regions = provider.regions;
  if (!isRegionManager(regions)) {
    throw new RegionError('unknown', `provider "${provider.name ?? 'custom'}" declares no region placement`);
  }
  if (regions.routed) return;
  const resolution = regions.resolve(regionClass);
  if (resolution?.status !== 'supported') {
    throw new RegionError(resolution?.status === 'unsupported' ? 'unsupported' : 'unknown',
      resolution?.reason ?? 'provider returned an invalid region resolution', resolution);
  }
}
