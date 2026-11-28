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

/**
 * How strictly `regionClass` applies.
 * - `prefer` (default): place in the first listed area the provider can serve, else where the provider defaults.
 * - `only`: place in a listed area or fail before create.
 */
export type RegionMode = 'prefer' | 'only';

export const REGION_MODES: readonly RegionMode[] = Object.freeze(['prefer', 'only']);

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

/** Where a create with `regionClass` was placed, from the adapter's declaration. */
export interface RegionPlacement {
  /** The requested areas, in preference order. */
  readonly requested: readonly RegionClass[];
  readonly mode: RegionMode;
  /** The requested area the instance was placed in; null when no preference could be met. */
  readonly matched: RegionClass | null;
  readonly placement: RegionPlacementKind;
  /** The provider's own region id; null when the provider's default placement was used. */
  readonly region: string | null;
  readonly provenance: 'adapter-declared';
}

export type RegionResolution =
  | {
    readonly status: 'supported';
    readonly requested: RegionClass;
    readonly placement: Exclude<RegionPlacementKind, 'provider-placed' | 'unknown'>;
    /** The provider's own region id for the area. */
    readonly region: string;
    readonly nativeOptions: Readonly<Record<string, unknown>>;
    readonly provenance: 'adapter-declared';
  }
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
  /** `options` are the create options, for adapters where some (e.g. attaching to an existing instance) bypass region selection. */
  support(options?: import('./types/universal-instance').CreateInstanceOptions): RegionSupport;
  resolve(regionClass: RegionClass, options?: import('./types/universal-instance').CreateInstanceOptions): RegionResolution;
}

/** fallback=false: an `only` region request never silently lands somewhere else. */
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

/** Areas in preference order from a single area or an ordered list. */
export function getRegionClasses(value: unknown): readonly RegionClass[] {
  const list = Array.isArray(value) ? value : [value];
  if (list.length === 0) throw new RegionError('invalid', 'expected at least one standard region');
  return Object.freeze([...new Set(list.map(getRegionClass))]);
}

export function getRegionMode(value: unknown): RegionMode {
  if (value === undefined) return 'prefer';
  if (typeof value !== 'string' || !(REGION_MODES as readonly string[]).includes(value)) {
    throw new RegionError('invalid', `regionMode must be one of ${REGION_MODES.join(', ')}`);
  }
  return value as RegionMode;
}

export interface RegionRequest {
  readonly requested: readonly RegionClass[];
  readonly mode: RegionMode;
}

/** Validate `regionClass` and `regionMode`; undefined when no region was requested. */
export function getRegionRequest(options?: { readonly regionClass?: unknown; readonly regionMode?: unknown }): RegionRequest | undefined {
  if (options?.regionClass === undefined) {
    if (options?.regionMode !== undefined) throw new RegionError('invalid', 'regionMode needs a regionClass');
    return undefined;
  }
  return { requested: getRegionClasses(options.regionClass), mode: getRegionMode(options.regionMode) };
}

/**
 * Resolve a request against an adapter's declaration: the first listed area it can serve wins.
 * With `only`, no match throws; with `prefer`, no match keeps the provider's default placement.
 */
export function resolveRegionRequest(
  manager: RegionManager,
  request: RegionRequest,
  options?: import('./types/universal-instance').CreateInstanceOptions,
): { readonly placement: RegionPlacement; readonly nativeOptions: Readonly<Record<string, unknown>> } {
  const misses: Exclude<RegionResolution, { status: 'supported' }>[] = [];
  for (const area of request.requested) {
    const resolution = manager.resolve(area, options);
    if (resolution.status === 'supported') {
      return {
        placement: Object.freeze({
          requested: request.requested, mode: request.mode, matched: area,
          placement: resolution.placement, region: resolution.region, provenance: 'adapter-declared' as const,
        }),
        nativeOptions: resolution.nativeOptions,
      };
    }
    misses.push(resolution);
  }
  const first = misses[0]!;
  if (request.mode === 'only') {
    const code = misses.some(miss => miss.status === 'unsupported') ? 'unsupported' : 'unknown';
    throw new RegionError(code, misses.map(miss => miss.reason).filter((r, i, all) => all.indexOf(r) === i).join(' '), first);
  }
  return {
    placement: Object.freeze({
      requested: request.requested, mode: request.mode, matched: null,
      placement: first.placement, region: null, provenance: 'adapter-declared' as const,
    }),
    nativeOptions: Object.freeze({}),
  };
}

/** Guard custom/legacy providers too: an `only` request must not reach a provider that cannot honor it. */
export function assertRegionSupported(
  provider: { readonly name?: string; readonly regions?: unknown },
  options?: import('./types/universal-instance').CreateInstanceOptions,
): void {
  const request = getRegionRequest(options);
  if (request?.mode !== 'only') return;
  const regions = provider.regions;
  if (!isRegionManager(regions)) {
    throw new RegionError('unknown', `provider "${provider.name ?? 'custom'}" declares no region placement`);
  }
  if (regions.routed) return;
  resolveRegionRequest(regions, request, options);
}
