/** Standard request targets, not measurements or guarantees of account/region availability. */
export type InstanceSizeClass = 'xs' | 'sm' | 'md' | 'lg' | 'xl' | '2xl' | '3xl';

export interface InstanceSizeProfile {
  readonly sizeClass: InstanceSizeClass;
  readonly vcpus: number;
  readonly memoryMiB: number;
}

export const INSTANCE_SIZE_PROFILES: Readonly<Record<InstanceSizeClass, InstanceSizeProfile>> = Object.freeze({
  xs: Object.freeze({ sizeClass: 'xs', vcpus: 1, memoryMiB: 1024 }),
  sm: Object.freeze({ sizeClass: 'sm', vcpus: 1, memoryMiB: 2048 }),
  md: Object.freeze({ sizeClass: 'md', vcpus: 2, memoryMiB: 4096 }),
  lg: Object.freeze({ sizeClass: 'lg', vcpus: 4, memoryMiB: 8192 }),
  xl: Object.freeze({ sizeClass: 'xl', vcpus: 8, memoryMiB: 16384 }),
  '2xl': Object.freeze({ sizeClass: '2xl', vcpus: 16, memoryMiB: 32768 }),
  '3xl': Object.freeze({ sizeClass: '3xl', vcpus: 32, memoryMiB: 65536 }),
});

/**
 * How far below a class's memory a shape's RAM may fall and still be that class.
 * vCPU picks the class; memory is a floor with this tolerance, and any shortfall is recorded.
 */
export const INSTANCE_SIZE_MEMORY_TOLERANCE = 0.1;

/** The least RAM (MiB) a shape needs to count as `profile`'s class. */
export function instanceSizeMemoryFloorMiB(profile: InstanceSizeProfile): number {
  return Math.ceil(profile.memoryMiB * (1 - INSTANCE_SIZE_MEMORY_TOLERANCE));
}

/** The vCPU count of the next class up, which a shape for `profile` must stay below; undefined for the top class. */
export function nextInstanceSizeVcpus(profile: InstanceSizeProfile): number | undefined {
  const above = Object.values(INSTANCE_SIZE_PROFILES).map(p => p.vcpus).filter(v => v > profile.vcpus);
  return above.length ? Math.min(...above) : undefined;
}

export type InstanceSizeStatus = 'supported' | 'unconfigured' | 'unavailable' | 'requires-build' | 'unknown' | 'unsupported';
export type InstanceSizeErrorCode = Exclude<InstanceSizeStatus, 'supported'> | 'invalid' | 'conflict';
export type InstanceSizeNativeValue = string | number | boolean | null | readonly InstanceSizeNativeValue[] | { readonly [key: string]: InstanceSizeNativeValue };
export type InstanceSizeNativeOptions = Readonly<Record<string, InstanceSizeNativeValue>>;

/** The provider's listed shape for a standard size; see {@link isValidInstanceSizeShape} for what qualifies. */
export interface InstanceSizeResources {
  readonly vcpus: number;
  readonly memoryMiB: number;
  readonly diskMiB?: number;
}

/** The adapter declares the provider's listed shape for the request; these are NOT observed resources. */
export interface InstanceSizeMetadata {
  readonly requested: InstanceSizeProfile;
  readonly resolved: InstanceSizeResources;
  /** Why the shape's RAM is below the profile, within the memory tolerance (e.g. a 16000 MB RAM cap). */
  readonly belowStandard?: string;
  /** How many MiB the shape's RAM is below the profile; set only when it is. */
  readonly memoryShortfallMiB?: number;
  readonly provenance: 'adapter-declared';
}

/**
 * Whether `resolved` is a valid shape for `profile`'s class. vCPU picks the class: at least the
 * profile's vCPU and below the next class's. RAM is a floor: at least the profile's memory less
 * {@link INSTANCE_SIZE_MEMORY_TOLERANCE}, and a shape below the profile's memory needs `belowStandard`
 * saying why. RAM above the profile is fine. All values are positive integers.
 */
export function isValidInstanceSizeShape(profile: InstanceSizeProfile, resolved: unknown, belowStandard?: unknown): resolved is InstanceSizeResources {
  if (resolved === null || typeof resolved !== 'object') return false;
  const { vcpus, memoryMiB, diskMiB } = resolved as Record<string, unknown>;
  const positive = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
  if (!positive(vcpus) || !positive(memoryMiB) || (diskMiB !== undefined && !positive(diskMiB))) return false;
  const next = nextInstanceSizeVcpus(profile);
  if (vcpus < profile.vcpus || (next !== undefined && vcpus >= next)) return false;
  if (memoryMiB < instanceSizeMemoryFloorMiB(profile)) return false;
  if (memoryMiB >= profile.memoryMiB) return belowStandard === undefined;
  return typeof belowStandard === 'string' && belowStandard.trim() !== '';
}

export type InstanceSizeResolution =
  | (InstanceSizeMetadata & { readonly status: 'supported'; readonly nativeOptions: InstanceSizeNativeOptions })
  | { readonly requested: InstanceSizeProfile; readonly provenance: 'adapter-declared'; readonly status: Exclude<InstanceSizeStatus, 'supported'>; readonly reason: string };

/** Pure local discovery. Never creates resources, builds images, or queries vendor APIs. */
export interface InstanceSizeManager {
  /** Explicit opt-in: an unrelated legacy `sizes` property is not a sizing contract. */
  readonly contract: 'computesdk.instance-sizes.v1';
  list(options?: import('./types/universal-instance').CreateInstanceOptions): readonly InstanceSizeResolution[];
  resolve(sizeClass: InstanceSizeClass, options?: import('./types/universal-instance').CreateInstanceOptions): InstanceSizeResolution;
}

/** Stable code and fallback=false prevent silently trying another provider/default size. */
export class InstanceSizeError extends Error {
  readonly fallback = false;
  constructor(readonly code: InstanceSizeErrorCode, message: string, readonly resolution?: InstanceSizeResolution) {
    super(`sizeClass: ${message}`);
    this.name = 'InstanceSizeError';
  }
}

export function getInstanceSizeProfile(sizeClass: unknown): InstanceSizeProfile {
  if (typeof sizeClass !== 'string' || !Object.prototype.hasOwnProperty.call(INSTANCE_SIZE_PROFILES, sizeClass)) {
    throw new InstanceSizeError('invalid', `invalid standard size (${typeof sizeClass === 'string' ? JSON.stringify(sizeClass) : typeof sizeClass})`);
  }
  return INSTANCE_SIZE_PROFILES[sizeClass as InstanceSizeClass];
}

/** Detect opt-in without invoking a sizeClass accessor or losing inherited fields in spreads. */
export function hasInstanceSizeRequest(options?: import('./types/universal-instance').CreateInstanceOptions): boolean {
  if (options === null || (typeof options !== 'object' && typeof options !== 'function')) return false;
  const descriptor = Object.getOwnPropertyDescriptor(options, 'sizeClass');
  if (!descriptor) {
    if ('sizeClass' in options) throw new InstanceSizeError('invalid', 'sizeClass must be an own create option');
    return false;
  }
  if (!('value' in descriptor)) throw new InstanceSizeError('invalid', 'sizeClass must not be an accessor');
  if (descriptor.value === undefined) return false;
  if (typeof options !== 'object' || !descriptor.enumerable) {
    throw new InstanceSizeError('invalid', 'defined sizeClass requires enumerable data on plain create options');
  }
  return true;
}

/** Native CPU/RAM/tier selectors must not ambiguously compete with the standard request. */
export function validateInstanceSizeOptions(options: import('./types/universal-instance').CreateInstanceOptions): InstanceSizeProfile {
  const prototype = Object.getPrototypeOf(options);
  if (prototype !== Object.prototype && prototype !== null) throw new InstanceSizeError('invalid', 'standard create options must be a plain object');
  const descriptors = Object.getOwnPropertyDescriptors(options);
  for (const key of Reflect.ownKeys(descriptors)) {
    const descriptor = Object.getOwnPropertyDescriptor(options, key)!;
    if (typeof key !== 'string' || ['__proto__', 'prototype', 'constructor'].includes(key) ||
        !('value' in descriptor) || !descriptor.enumerable) {
      throw new InstanceSizeError('invalid', 'standard create options require safe enumerable string-key data properties');
    }
  }
  if (!Object.prototype.hasOwnProperty.call(descriptors, 'sizeClass')) {
    throw new InstanceSizeError('invalid', 'sizeClass must be an own create option');
  }
  const profile = getInstanceSizeProfile(descriptors.sizeClass!.value);
  const conflicts = ['cpu', 'cpuLimit', 'cpus', 'vcpus', 'memory', 'memoryMiB', 'memMiB', 'memoryMb',
    'resources', 'launch_parameters', 'deploymentPlan', 'size', 'vmTier'];
  const field = conflicts.find(key => Object.prototype.hasOwnProperty.call(descriptors, key) && descriptors[key].value !== undefined);
  if (field) throw new InstanceSizeError('conflict', `cannot combine sizeClass with ${field}`);
  return profile;
}

/** Narrow the permissive legacy extension slot only when its explicit contract is present. */
export function isInstanceSizeManager(value: unknown): value is InstanceSizeManager {
  return value !== null && (typeof value === 'object' || typeof value === 'function') &&
    'contract' in value && value.contract === 'computesdk.instance-sizes.v1' &&
    'resolve' in value && typeof value.resolve === 'function' &&
    'list' in value && typeof value.list === 'function';
}

/** Guard custom/legacy providers too: a missing contract must not silently ignore a request. */
export function assertInstanceSizeSupported(
  provider: { readonly name?: string; readonly sizes?: unknown },
  options?: import('./types/universal-instance').CreateInstanceOptions,
): void {
  if (!hasInstanceSizeRequest(options)) return;
  const profile = validateInstanceSizeOptions(options!);
  if (options!.signal?.aborted) {
    const error = new Error('Instance creation aborted');
    error.name = 'AbortError';
    throw error;
  }
  const sizes = provider.sizes;
  if (!isInstanceSizeManager(sizes)) {
    throw new InstanceSizeError('unknown', `provider "${provider.name ?? 'custom'}" has no standard sizing contract`);
  }
  const resolution = sizes.resolve(profile.sizeClass, options);
  if (!resolution || !['supported', 'unknown', 'unsupported', 'unconfigured', 'unavailable', 'requires-build'].includes(resolution.status)) {
    throw new InstanceSizeError('unknown', 'provider returned an invalid standard sizing resolution');
  }
  if (resolution.status !== 'supported') {
    throw new InstanceSizeError(resolution.status, resolution.reason, resolution);
  }
  if (resolution.provenance !== 'adapter-declared' || resolution.requested?.sizeClass !== profile.sizeClass ||
      resolution.requested?.vcpus !== profile.vcpus || resolution.requested?.memoryMiB !== profile.memoryMiB ||
      !isValidInstanceSizeShape(profile, resolution.resolved, resolution.belowStandard)) {
    throw new InstanceSizeError('unknown', 'provider did not declare a valid standard sizing shape');
  }
}
