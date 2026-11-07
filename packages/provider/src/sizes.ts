import {
  INSTANCE_SIZE_PROFILES, InstanceSizeError, getInstanceSizeProfile, hasInstanceSizeRequest, validateInstanceSizeOptions,
  type CreateInstanceOptions, type InstanceSizeManager, type InstanceSizeNativeOptions,
  type InstanceSizeProfile, type InstanceSizeResolution, type InstanceSizeStatus,
} from 'computesdk';

/** Exact, non-secret resource-only native patch; never copy caller passthrough bodies. */
export type InstanceSizeSupport =
  | { readonly status: 'supported'; readonly nativeOptions: InstanceSizeNativeOptions }
  | { readonly status: Exclude<InstanceSizeStatus, 'supported'>; readonly reason: string };

/** Provider-owned, synchronous and side-effect-free: no credentials validation, API calls or builds. */
export type InstanceSizeResolver<TConfig> = (
  config: TConfig, profile: InstanceSizeProfile, options?: CreateInstanceOptions,
) => InstanceSizeSupport;

const UNSAFE_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/** Inspect descriptors without invoking getters or traversing inherited properties. */
function safeDescriptors(value: unknown): PropertyDescriptorMap {
  if (!isPlainRecord(value)) throw new InstanceSizeError('invalid', 'sizing resource context must be a plain object');
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const key of Reflect.ownKeys(descriptors)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
    if (typeof key !== 'string' || UNSAFE_KEYS.has(key) || !('value' in descriptor) || !descriptor.enumerable) {
      throw new InstanceSizeError('invalid', 'sizing resource context requires safe enumerable string-key data properties');
    }
  }
  return descriptors;
}

// Only these existing Namespace paths need nested merging. Do not normalize arbitrary caller data.
function ownValue(descriptors: PropertyDescriptorMap, key: string): unknown {
  return Object.prototype.hasOwnProperty.call(descriptors, key) ? descriptors[key].value : undefined;
}

function validateResourceContext(options?: CreateInstanceOptions): void {
  if (!options) return;
  const root = safeDescriptors(options);
  const sandbox = ownValue(root, 'sandbox');
  if (sandbox !== undefined) safeDescriptors(sandbox);
  const instance = ownValue(root, 'instanceOptions');
  if (instance === undefined) return;
  const descriptors = safeDescriptors(instance);
  const shape = ownValue(descriptors, 'shape');
  if (shape !== undefined) safeDescriptors(shape);
}

// Copy/freeze only the small adapter-declared descriptor, never arbitrary create options or live objects.
function immutableCopy<T>(value: T, ancestors = new Set<object>()): T {
  if (value === null || typeof value !== 'object') {
    if (!['string', 'number', 'boolean'].includes(typeof value) && value !== null) {
      throw new InstanceSizeError('invalid', 'size descriptor must contain only plain data');
    }
    return value;
  }
  if (ancestors.has(value)) throw new InstanceSizeError('invalid', 'cyclic size descriptor');
  ancestors.add(value);
  let copy: unknown;
  if (Array.isArray(value)) {
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (Reflect.ownKeys(descriptors).some(key => {
      if (key === 'length') return false;
      const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
      return typeof key !== 'string' || !/^\d+$/.test(key) || !('value' in descriptor) || !descriptor.enumerable;
    })) {
      throw new InstanceSizeError('invalid', 'unsafe size descriptor array');
    }
    copy = Object.freeze(Array.from({ length: value.length }, (_, index) => {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (!descriptor || !('value' in descriptor)) throw new InstanceSizeError('invalid', 'sparse size descriptor array');
      return immutableCopy(descriptor.value, ancestors);
    }));
  } else {
    copy = Object.freeze(Object.fromEntries(Object.entries(safeDescriptors(value))
      .filter(([, descriptor]) => descriptor.enumerable)
      .map(([key, descriptor]) => [key, immutableCopy(descriptor.value, ancestors)])));
  }
  ancestors.delete(value);
  return copy as T;
}

export function createInstanceSizeManager<TConfig>(config: TConfig, resolver?: InstanceSizeResolver<TConfig>): InstanceSizeManager {
  const resolve: InstanceSizeManager['resolve'] = (sizeClass, options) => {
    const profile = getInstanceSizeProfile(sizeClass);
    if (hasInstanceSizeRequest(options)) validateInstanceSizeOptions(options!);
    validateResourceContext(options);
    if (options?.sizeClass !== undefined && options.sizeClass !== sizeClass) {
      throw new InstanceSizeError('conflict', 'resolve size differs from options.sizeClass');
    }
    validateInstanceSizeOptions({ ...options, sizeClass });
    const support = resolver?.(config, profile, options) ?? {
      status: 'unknown' as const, reason: 'This adapter has no verified standard sizing mapping.',
    };
    if (support.status === 'supported') {
      const patch = safeDescriptors(support.nativeOptions);
      if (Object.prototype.hasOwnProperty.call(patch, 'sizeClass')) throw new InstanceSizeError('conflict', 'resolver cannot emit SDK-only sizeClass as a native option');
    }
    const base = { requested: profile, provenance: 'adapter-declared' as const };
    const resolution: InstanceSizeResolution = support.status === 'supported'
      ? { ...base, status: 'supported', resolved: { vcpus: profile.vcpus, memoryMiB: profile.memoryMiB }, nativeOptions: support.nativeOptions }
      : { ...base, status: support.status, reason: support.reason };
    return immutableCopy(resolution);
  };
  return Object.freeze({
    contract: 'computesdk.instance-sizes.v1' as const,
    resolve,
    list: (options?: CreateInstanceOptions) => {
      if (hasInstanceSizeRequest(options)) validateInstanceSizeOptions(options!);
      validateResourceContext(options);
      return Object.freeze(Object.values(INSTANCE_SIZE_PROFILES).map(profile =>
        resolve(profile.sizeClass, options ? { ...options, sizeClass: undefined } : undefined),
      ));
    },
  });
}

/** Apply flat resource fields, merging only the known Namespace instanceOptions.shape path. */
export function applyInstanceSizePatch(options: CreateInstanceOptions, patch: InstanceSizeNativeOptions): CreateInstanceOptions {
  validateResourceContext(options);
  const safePatch = immutableCopy(patch);
  const result = { ...options, ...safePatch };
  if (Object.prototype.hasOwnProperty.call(safePatch, 'instanceOptions')) {
    const patchInstance = safeDescriptors(safePatch.instanceOptions);
    const currentInstance = safeDescriptors(Object.getOwnPropertyDescriptor(options, 'instanceOptions')?.value ?? {});
    const instance = Object.fromEntries(Object.entries(currentInstance).filter(([, d]) => d.enumerable).map(([k, d]) => [k, d.value]));
    const update = Object.fromEntries(Object.entries(patchInstance).filter(([, d]) => d.enumerable).map(([k, d]) => [k, d.value]));
    result.instanceOptions = { ...instance, ...update };
    if (Object.prototype.hasOwnProperty.call(patchInstance, 'shape')) {
      const before = safeDescriptors(ownValue(currentInstance, 'shape') ?? {});
      const after = safeDescriptors(patchInstance.shape.value);
      result.instanceOptions.shape = Object.fromEntries([...Object.entries(before), ...Object.entries(after)]
        .filter(([, d]) => d.enumerable).map(([k, d]) => [k, d.value]));
    }
  }
  return result;
}
