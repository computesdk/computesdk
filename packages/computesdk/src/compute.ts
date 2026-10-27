/**
 * Compute API - Direct Provider Implementation
 *
 * `compute` delegates to one or more configured provider instances directly.
 */

import type {
  Instance as InstanceInterface,
  CreateInstanceOptions as UniversalCreateInstanceOptions,
  Volume,
  CreateVolumeOptions,
  ListVolumesOptions,
} from './types/universal-instance';

export interface CreateInstanceOptions extends UniversalCreateInstanceOptions {
  /** Optional provider name override (must match provider.name) */
  provider?: string;
}

/**
 * @deprecated Use {@link CreateInstanceOptions} instead.
 */
export type CreateSandboxOptions = CreateInstanceOptions;

export interface CreateSnapshotOptions {
  name?: string;
  metadata?: Record<string, any>;
  /** Optional provider name override (must match provider.name) */
  provider?: string;
}

export interface ComputeCreateVolumeOptions extends CreateVolumeOptions {
  /** Optional provider name override (must match provider.name) */
  provider?: string;
}

interface ProviderInstanceManager {
  create(options?: CreateInstanceOptions): Promise<InstanceInterface>;
  getById(instanceId: string): Promise<InstanceInterface | null>;
  list?(): Promise<InstanceInterface[]>;
  destroy(instanceId: string): Promise<void>;
}

interface ProviderSnapshotManager {
  create(instanceId: string, options?: { name?: string; metadata?: Record<string, any> }): Promise<{ id: string; provider: string; createdAt: Date | string; metadata?: Record<string, any> }>;
  list(): Promise<Array<{ id: string; provider: string; createdAt: Date | string; metadata?: Record<string, any> }>>;
  delete(snapshotId: string): Promise<void>;
}

interface ProviderVolumeManager {
  create(options: CreateVolumeOptions): Promise<Volume>;
  get(volumeIdOrName: string): Promise<Volume | null>;
  list(options?: ListVolumesOptions): Promise<Volume[]>;
  delete(volumeIdOrName: string): Promise<void>;
}

export interface DirectProvider {
  readonly name?: string;
  /** Instance lifecycle manager (canonical). */
  readonly instances?: ProviderInstanceManager;
  /**
   * @deprecated Use `instances`. Still honored: a provider exposing only
   * `sandbox` is treated as exposing `instances`.
   */
  readonly sandbox?: ProviderInstanceManager;
  readonly snapshot?: ProviderSnapshotManager;
  readonly volume?: ProviderVolumeManager;
}

/**
 * Explicit compute configuration for callable mode.
 *
 * Use `provider` for single-provider mode or `providers` for multi-provider mode.
 */
export interface ExplicitComputeConfig {
  /** Single-provider mode */
  provider?: DirectProvider;
  /** Multi-provider mode (recommended for resilient routing) */
  providers?: DirectProvider[];
  /** Provider selection strategy when no explicit provider is passed */
  providerStrategy?: 'priority' | 'round-robin';
  /** Retry the next provider when create fails */
  fallbackOnError?: boolean;
}

function getInstanceManager(provider: DirectProvider): ProviderInstanceManager | undefined {
  return provider.instances ?? provider.sandbox;
}

function isProviderLike(value: unknown): value is DirectProvider {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  const manager = (candidate.instances ?? candidate.sandbox) as Record<string, unknown> | undefined;
  return !!(
    manager &&
    typeof manager.create === 'function' &&
    typeof manager.getById === 'function' &&
    typeof manager.destroy === 'function'
  );
}

function getProviderLabel(provider: DirectProvider, index: number): string {
  return provider.name || `provider-${index + 1}`;
}

function getInstanceId(instance: InstanceInterface): string | undefined {
  if (typeof instance.instanceId === 'string') {
    return instance.instanceId;
  }
  // Legacy provider objects that predate the instanceId rename.
  if ('sandboxId' in instance && typeof instance.sandboxId === 'string') {
    return instance.sandboxId;
  }
  return undefined;
}

function getProviderErrorDetail(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

/**
 * AggregateError-style failure for multi-provider creates: the original
 * errors stay inspectable on `.errors` (`AggregateError` itself isn't in the
 * es2020 lib this package targets).
 */
class MultiProviderError extends Error {
  constructor(
    public errors: unknown[],
    message: string,
  ) {
    super(message);
    this.name = 'AggregateError';
  }
}

function resolveProviders(config: ExplicitComputeConfig): DirectProvider[] {
  const candidates: unknown[] = [];

  // Primary single-provider entrypoint wins ordering when both are provided.
  if (config.provider) {
    candidates.push(config.provider);
  }

  if (Array.isArray(config.providers)) {
    candidates.push(...config.providers);
  }

  const providers: DirectProvider[] = [];
  const seen = new Set<DirectProvider>();
  const seenNames = new Set<string>();

  for (const candidate of candidates) {
    if (!isProviderLike(candidate)) continue;
    if (seen.has(candidate)) continue;

    const name = candidate.name;
    if (name && seenNames.has(name)) continue;

    providers.push(candidate);
    seen.add(candidate);
    if (name) {
      seenNames.add(name);
    }
  }

  if (providers.length > 0) {
    return providers;
  }

  throw new Error(
    'No provider instance configured.\n\n' +
    'Configure compute with provider instances:\n\n' +
    '  compute.setConfig({ providers: [e2b({...}), modal({...})] })\n' +
    '  // or: compute.setConfig({ provider: e2b({...}) })'
  );
}

class ComputeManager {
  private providers: DirectProvider[] = [];
  private providerStrategy: 'priority' | 'round-robin' = 'priority';
  private fallbackOnError = true;
  private roundRobinCursor = 0;
  private instanceProviders = new Map<string, DirectProvider>();
  private snapshotProviders = new Map<string, DirectProvider>();
  private volumeProviders = new Map<string, DirectProvider>();
  private getProviders(): DirectProvider[] {
    if (this.providers.length === 0) {
      throw new Error(
        'No compute provider configured.\n\n' +
        'Options:\n' +
        '1. Configure providers: compute.setConfig({ providers: [e2b({...}), modal({...})] })\n' +
        '2. Configure a single provider: compute.setConfig({ provider: e2b({...}) })\n' +
        '3. Use provider directly: const sdk = e2b({...}); await sdk.instances.create()'
      );
    }
    return this.providers;
  }

  private getProviderByName(name: string): DirectProvider {
    const provider = this.getProviders().find((p) => p.name === name);
    if (!provider) {
      const names = this.getProviders().map((p, i) => getProviderLabel(p, i)).join(', ');
      throw new Error(`Provider "${name}" is not configured. Configured providers: ${names || '(none)'}.`);
    }
    return provider;
  }

  private registerInstanceProvider(instance: InstanceInterface, provider: DirectProvider): void {
    const instanceId = getInstanceId(instance);
    if (instanceId) {
      this.instanceProviders.set(instanceId, provider);
    }
  }

  private getCreateCandidates(preferredProviderName?: string): DirectProvider[] {
    const providers = this.getProviders();
    if (preferredProviderName) {
      return [this.getProviderByName(preferredProviderName)];
    }

    if (providers.length <= 1 || this.providerStrategy === 'priority') {
      return [...providers];
    }

    const start = this.roundRobinCursor % providers.length;
    this.roundRobinCursor = (this.roundRobinCursor + 1) % providers.length;
    return [
      ...providers.slice(start),
      ...providers.slice(0, start),
    ];
  }

  private getByIdCandidates(instanceId: string): DirectProvider[] {
    const known = this.instanceProviders.get(instanceId);
    if (!known) return this.getProviders();
    const providers = this.getProviders();
    return [known, ...providers.filter((p) => p !== known)];
  }

  private getSnapshotDeleteCandidates(snapshotId: string): DirectProvider[] {
    const known = this.snapshotProviders.get(snapshotId);
    const providers = this.getProviders().filter((p) => !!p.snapshot);
    if (!known) return providers;
    return [known, ...providers.filter((p) => p !== known)];
  }

  private getSnapshotCreateCandidates(instanceId: string, preferredProviderName?: string): DirectProvider[] {
    if (preferredProviderName) {
      return [this.getProviderByName(preferredProviderName)];
    }

    const known = this.instanceProviders.get(instanceId);
    const providers = this.getProviders().filter((p) => !!p.snapshot);

    if (known && known.snapshot) {
      return [known, ...providers.filter((p) => p !== known)];
    }

    return providers;
  }

  private async createWithFallback(options?: CreateInstanceOptions): Promise<InstanceInterface> {
    const preferredProviderName = options?.provider;
    // `provider` is routing metadata consumed by ComputeManager. `kind` is
    // reserved vocabulary (not yet in the type): strip it too so callers
    // passing it via the index signature don't leak it into provider
    // create options, where strict validators (e.g. Sail) reject it.
    const { provider: _providerName, kind: _kind, ...providerOptions } = options || {};
    const candidates = this.getCreateCandidates(preferredProviderName);
    const canFallback = this.fallbackOnError && !preferredProviderName;
    const errors: string[] = [];
    const providerErrors: unknown[] = [];

    for (const [index, provider] of candidates.entries()) {
      try {
        const instance = await getInstanceManager(provider)!.create(providerOptions);
        if (
          providerOptions?.egress &&
          typeof providerOptions.egress === 'object' &&
          !Array.isArray(providerOptions.egress) &&
          !instance.egress
        ) {
          // The provider accepted the option but did not honor it — destroy
          // the instance rather than hand back one without egress routing.
          const orphanId = getInstanceId(instance);
          if (orphanId) {
            getInstanceManager(provider)!.destroy(orphanId).catch(() => {});
          }
          throw new Error(
            `egress: provider "${getProviderLabel(provider, index)}" does not support the "egress" option`
          );
        }
        this.registerInstanceProvider(instance, provider);
        return instance;
      } catch (error) {
        // AbortErrors should not be treated as provider failures; rethrow immediately
        if (error instanceof Error && (error as any).name === 'AbortError') {
          throw error;
        }
        // `fallback: false` marks an error whose outcome is unknown — e.g.
        // @computesdk/platform's create_outcome_unknown, where a hosted box
        // may already exist and be billing. Trying the next provider could
        // boot a second box, so rethrow immediately.
        if (error instanceof Error && (error as { fallback?: boolean }).fallback === false) {
          throw error;
        }
        providerErrors.push(error);
        errors.push(`${getProviderLabel(provider, index)}: ${getProviderErrorDetail(error)}`);
        if (!canFallback) {
          throw error;
        }
      }
    }

    // Keep the original provider errors on `.errors` so callers can inspect
    // each provider's error code in multi-provider mode.
    throw new MultiProviderError(
      providerErrors,
      `Failed to create instance across ${candidates.length} provider(s).\n` +
      errors.map((error) => `- ${error}`).join('\n')
    );
  }

  setConfig(config: ExplicitComputeConfig): void {
    this.providers = resolveProviders(config);
    this.providerStrategy = config.providerStrategy ?? 'priority';
    this.fallbackOnError = config.fallbackOnError ?? true;
    this.roundRobinCursor = 0;
    this.instanceProviders.clear();
    this.snapshotProviders.clear();
    this.volumeProviders.clear();
  }

  instances = {
    create: async (options?: CreateInstanceOptions): Promise<InstanceInterface> => {
      return this.createWithFallback(options);
    },

    getById: async (instanceId: string): Promise<InstanceInterface | null> => {
      for (const provider of this.getByIdCandidates(instanceId)) {
        const instance = await getInstanceManager(provider)!.getById(instanceId);
        if (instance) {
          this.registerInstanceProvider(instance, provider);
          return instance;
        }
      }

      this.instanceProviders.delete(instanceId);
      return null;
    },

    list: async (): Promise<InstanceInterface[]> => {
      const all: InstanceInterface[] = [];

      for (const provider of this.getProviders()) {
        const manager = getInstanceManager(provider)!;
        if (!manager.list) {
          continue;
        }

        const instances = await manager.list();
        for (const instance of instances) {
          this.registerInstanceProvider(instance, provider);
        }
        all.push(...instances);
      }

      return all;
    },

    destroy: async (instanceId: string): Promise<void> => {
      const candidates = this.getByIdCandidates(instanceId);
      const errors: string[] = [];

      for (const [index, provider] of candidates.entries()) {
        try {
          await getInstanceManager(provider)!.destroy(instanceId);
          this.instanceProviders.delete(instanceId);
          return;
        } catch (error) {
          errors.push(`${getProviderLabel(provider, index)}: ${getProviderErrorDetail(error)}`);
        }
      }

      throw new Error(
        `Failed to destroy instance "${instanceId}" across ${candidates.length} provider(s).\n` +
        errors.map((error) => `- ${error}`).join('\n')
      );
    },
  };

  /**
   * @deprecated Use `compute.instances`. The sandbox namespace collapsed into
   * instances so every form of compute (sandbox, VM, baremetal) shares one API.
   */
  get sandbox() {
    return this.instances;
  }

  snapshot = {
    create: async (instanceId: string, options?: CreateSnapshotOptions): Promise<{ id: string; provider: string; createdAt: Date; metadata?: Record<string, any> }> => {
      const preferredProviderName = options?.provider;
      const { provider: _providerName, ...providerOptions } = options || {};
      const candidates = this.getSnapshotCreateCandidates(instanceId, preferredProviderName);
      const errors: string[] = [];

      for (const [index, provider] of candidates.entries()) {
        if (!provider.snapshot) {
          errors.push(`${getProviderLabel(provider, index)}: snapshots not supported`);
          continue;
        }

        try {
          const snapshot = await provider.snapshot.create(instanceId, providerOptions);
          this.snapshotProviders.set(snapshot.id, provider);
          return {
            ...snapshot,
            createdAt: new Date(snapshot.createdAt),
          };
        } catch (error) {
          errors.push(`${getProviderLabel(provider, index)}: ${getProviderErrorDetail(error)}`);
        }
      }

      throw new Error(
        `Failed to create snapshot for instance "${instanceId}" across ${candidates.length} provider(s).\n` +
        errors.map((error) => `- ${error}`).join('\n')
      );
    },

    list: async (): Promise<Array<{ id: string; provider: string; createdAt: Date; metadata?: Record<string, any> }>> => {
      const snapshots: Array<{ id: string; provider: string; createdAt: Date; metadata?: Record<string, any> }> = [];

      for (const provider of this.getProviders()) {
        if (!provider.snapshot) continue;
        const listed = await provider.snapshot.list();
        for (const snapshot of listed) {
          this.snapshotProviders.set(snapshot.id, provider);
          snapshots.push({
            ...snapshot,
            createdAt: new Date(snapshot.createdAt),
          });
        }
      }

      return snapshots;
    },

    delete: async (snapshotId: string): Promise<void> => {
      const candidates = this.getSnapshotDeleteCandidates(snapshotId);
      const errors: string[] = [];

      for (const [index, provider] of candidates.entries()) {
        if (!provider.snapshot) continue;
        try {
          await provider.snapshot.delete(snapshotId);
          this.snapshotProviders.delete(snapshotId);
          return;
        } catch (error) {
          errors.push(`${getProviderLabel(provider, index)}: ${getProviderErrorDetail(error)}`);
        }
      }

      throw new Error(
        `Failed to delete snapshot "${snapshotId}" across ${candidates.length} provider(s).\n` +
        errors.map((error) => `- ${error}`).join('\n')
      );
    },
  };

  /**
   * Persistent volumes. Only providers exposing `provider.volume` participate;
   * `create` targets the named provider or the first configured one that
   * supports volumes.
   */
  volume = {
    create: async (options: ComputeCreateVolumeOptions): Promise<Volume> => {
      const preferredProviderName = options?.provider;
      const { provider: _providerName, ...providerOptions } = options || {};
      const candidates = preferredProviderName
        ? [this.getProviderByName(preferredProviderName)]
        : this.getProviders().filter((p) => !!p.volume);
      const errors: string[] = [];

      for (const [index, provider] of candidates.entries()) {
        if (!provider.volume) {
          errors.push(`${getProviderLabel(provider, index)}: volumes not supported`);
          continue;
        }

        try {
          const volume = await provider.volume.create(providerOptions);
          if (volume.id) this.volumeProviders.set(volume.id, provider);
          if (volume.name && volume.name !== volume.id) this.volumeProviders.set(volume.name, provider);
          return volume;
        } catch (error) {
          errors.push(`${getProviderLabel(provider, index)}: ${getProviderErrorDetail(error)}`);
          if (preferredProviderName) throw error;
        }
      }

      throw new Error(
        `Failed to create volume "${providerOptions.name}" across ${candidates.length} provider(s).\n` +
        errors.map((error) => `- ${error}`).join('\n')
      );
    },

    get: async (volumeIdOrName: string, providerName?: string): Promise<Volume | null> => {
      const known = this.volumeProviders.get(volumeIdOrName);
      const candidates = providerName
        ? [this.getProviderByName(providerName)]
        : known
          ? [known, ...this.getProviders().filter((p) => p !== known && !!p.volume)]
          : this.getProviders().filter((p) => !!p.volume);

      for (const provider of candidates) {
        if (!provider.volume) continue;
        const volume = await provider.volume.get(volumeIdOrName);
        if (volume) {
          this.volumeProviders.set(volumeIdOrName, provider);
          return volume;
        }
      }
      return null;
    },

    list: async (options?: ListVolumesOptions & { provider?: string }): Promise<Volume[]> => {
      const candidates = options?.provider
        ? [this.getProviderByName(options.provider)]
        : this.getProviders().filter((p) => !!p.volume);
      const volumes: Volume[] = [];

      for (const provider of candidates) {
        if (!provider.volume) continue;
        let listed: Volume[];
        try {
          listed = await provider.volume.list(options);
        } catch (error) {
          // Providers without a volume-list API (e.g. modal) throw the
          // factory's 'does not support listing' stub — skip only those.
          // Real failures (network, RBAC, 5xx) must surface: returning a
          // partial inventory as success hides provider outages.
          if (/does not support listing/i.test(getProviderErrorDetail(error))) continue;
          throw error;
        }
        for (const volume of listed) {
          if (volume.id) this.volumeProviders.set(volume.id, provider);
          if (volume.name) this.volumeProviders.set(volume.name, provider);
          volumes.push({ provider: provider.name, ...volume });
        }
      }
      return volumes;
    },

    delete: async (volumeIdOrName: string, providerName?: string): Promise<void> => {
      const known = this.volumeProviders.get(volumeIdOrName);
      // When the owning provider is known, delete only there — retrying the
      // same id/name on other providers could delete a *different* volume
      // (or report an idempotent success while the real volume remains).
      const candidates = providerName
        ? [this.getProviderByName(providerName)]
        : known
          ? [known]
          : this.getProviders().filter((p) => !!p.volume);
      const errors: string[] = [];

      for (const [index, provider] of candidates.entries()) {
        if (!provider.volume) continue;
        try {
          await provider.volume.delete(volumeIdOrName);
          this.volumeProviders.delete(volumeIdOrName);
          return;
        } catch (error) {
          errors.push(`${getProviderLabel(provider, index)}: ${getProviderErrorDetail(error)}`);
        }
      }

      throw new Error(
        `Failed to delete volume "${volumeIdOrName}" across ${candidates.length} provider(s).\n` +
        errors.map((error) => `- ${error}`).join('\n')
      );
    },
  };
}

const singletonInstance = new ComputeManager();

function computeFactory(config: ExplicitComputeConfig): ComputeManager {
  const manager = new ComputeManager();
  manager.setConfig(config);
  return manager;
}

export interface CallableCompute extends ComputeManager {
  (config: ExplicitComputeConfig): ComputeManager;
  setConfig(config: ExplicitComputeConfig): void;
}

export const compute: CallableCompute = new Proxy(
  computeFactory as any,
  {
    get(_target, prop, _receiver) {
      const singleton = singletonInstance as any;
      const value = singleton[prop];
      if (typeof value === 'function') {
        return value.bind(singletonInstance);
      }
      return value;
    },
    apply(_target, _thisArg, args) {
      return computeFactory(args[0] as ExplicitComputeConfig);
    }
  }
);
