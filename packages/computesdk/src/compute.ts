/**
 * Compute API - Direct Provider Implementation
 *
 * `compute` delegates to one or more configured provider instances directly.
 */

import type {
  Sandbox as SandboxInterface,
  CreateSandboxOptions as UniversalCreateSandboxOptions,
  Volume,
  CreateVolumeOptions as UniversalCreateVolumeOptions,
  AttachVolumeOptions as UniversalAttachVolumeOptions,
  ListVolumesOptions as UniversalListVolumesOptions,
} from './types/universal-sandbox';

export interface CreateSandboxOptions extends UniversalCreateSandboxOptions {
  /** Optional provider name override (must match provider.name) */
  provider?: string;
}

export interface CreateSnapshotOptions {
  name?: string;
  metadata?: Record<string, any>;
  /** Optional provider name override (must match provider.name) */
  provider?: string;
}

export interface CreateVolumeOptions extends UniversalCreateVolumeOptions {
  /** Optional provider name override (must match provider.name) */
  provider?: string;
}

export interface AttachVolumeOptions extends UniversalAttachVolumeOptions {
  /** Optional provider name override (must match provider.name) */
  provider?: string;
}

export interface ListVolumesOptions extends UniversalListVolumesOptions {
  /** Optional provider name override (must match provider.name) */
  provider?: string;
}

export interface DeleteVolumeOptions {
  /** Optional provider name override (must match provider.name) */
  provider?: string;
}

interface ProviderSandboxManager {
  create(options?: CreateSandboxOptions): Promise<SandboxInterface>;
  getById(sandboxId: string): Promise<SandboxInterface | null>;
  list?(): Promise<SandboxInterface[]>;
  destroy(sandboxId: string): Promise<void>;
}

interface ProviderSnapshotManager {
  create(sandboxId: string, options?: { name?: string; metadata?: Record<string, any> }): Promise<{ id: string; provider: string; createdAt: Date | string; metadata?: Record<string, any> }>;
  list(): Promise<Array<{ id: string; provider: string; createdAt: Date | string; metadata?: Record<string, any> }>>;
  delete(snapshotId: string): Promise<void>;
}

interface ProviderVolumeManager {
  create?(options?: CreateVolumeOptions): Promise<Volume>;
  list?(options?: ListVolumesOptions): Promise<Volume[]>;
  getById?(volumeId: string): Promise<Volume | null>;
  delete?(volumeId: string): Promise<void>;
  attach?(volumeId: string, sandboxId: string, options?: AttachVolumeOptions): Promise<void>;
  detach?(volumeId: string, sandboxId: string, options?: AttachVolumeOptions): Promise<void>;
}

export interface DirectProvider {
  readonly name?: string;
  readonly sandbox: ProviderSandboxManager;
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

function isProviderLike(value: unknown): value is DirectProvider {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  const sandbox = candidate.sandbox as Record<string, unknown> | undefined;
  return !!(
    sandbox &&
    typeof sandbox.create === 'function' &&
    typeof sandbox.getById === 'function' &&
    typeof sandbox.destroy === 'function'
  );
}

function getProviderLabel(provider: DirectProvider, index: number): string {
  return provider.name || `provider-${index + 1}`;
}

function getSandboxId(sandbox: SandboxInterface): string | undefined {
  if ('sandboxId' in sandbox && typeof sandbox.sandboxId === 'string') {
    return sandbox.sandboxId;
  }
  return undefined;
}

function getProviderErrorDetail(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

const VOLUME_WORDS = new Set(['volume', 'vol', 'disk', 'pvc', 'persistentvolume']);
const PARENT_RESOURCE_WORDS = new Set([
  'workspace', 'endpoint', 'namespace', 'pod', 'node', 'cluster', 'container', 'deployment',
  'service', 'secret', 'configmap', 'config', 'job', 'cronjob', 'persistentvolumeclaim',
  'sandbox', 'template', 'snapshot', 'account', 'project', 'organization', 'team',
  'subscription', 'billing', 'network', 'subnet', 'firewall', 'loadbalancer', 'route',
  'database', 'instance', 'vm', 'server', 'host', 'credential', 'token', 'permission',
]);
const ABSENCE_PHRASES = ['not found', 'does not exist', 'doesn\'t exist'];

function normalizeResourceToken(token: string): string {
  return token.toLowerCase().replace(/[^a-z0-9\-]/g, '');
}

function isVolumeWord(token: string): boolean {
  const normalized = normalizeResourceToken(token);
  if (VOLUME_WORDS.has(normalized)) return true;
  // Common volume id prefixes (e.g. "vol-123", "pvc-abc") indicate the missing object is a volume.
  return /^vol-/.test(normalized) || /^pvc-/.test(normalized) || /^disk-/.test(normalized);
}

function messageRefersToVolumeAbsence(message: string): boolean {
  const lower = message.toLowerCase();
  if (/\bno such volume\b/.test(lower)) return true;

  for (const phrase of ABSENCE_PHRASES) {
    let index = 0;
    while ((index = lower.indexOf(phrase, index)) !== -1) {
      const before = lower.slice(0, index).trimEnd();
      const tokens = before.split(/\s+/);

      // Walk backwards from the phrase to find the nearest resource word. If it's a
      // volume word, the absence refers to the volume; if a parent resource word is
      // closer, the message is about that parent resource being missing.
      for (let i = tokens.length - 1; i >= 0; i--) {
        const token = normalizeResourceToken(tokens[i]);
        if (!token) continue;
        if (isVolumeWord(token) || VOLUME_WORDS.has(token)) {
          return true;
        }
        if (PARENT_RESOURCE_WORDS.has(token)) {
          break;
        }
      }
      index += phrase.length;
    }
  }
  return false;
}

function isVolumeNotFoundError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const e = error as { statusCode?: number; code?: number; name?: string; message?: string };
  if (e.statusCode === 404 || e.code === 404) return true;
  if (e.name === 'NotFoundError') return true;
  if (typeof e.message === 'string') {
    return messageRefersToVolumeAbsence(e.message);
  }
  return false;
}

class VolumeAmbiguityError extends Error {}
class VolumeLookupAggregateError extends Error {}

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
  private sandboxProviders = new Map<string, DirectProvider>();
  private snapshotProviders = new Map<string, DirectProvider>();
  private getProviders(): DirectProvider[] {
    if (this.providers.length === 0) {
      throw new Error(
        'No compute provider configured.\n\n' +
        'Options:\n' +
        '1. Configure providers: compute.setConfig({ providers: [e2b({...}), modal({...})] })\n' +
        '2. Configure a single provider: compute.setConfig({ provider: e2b({...}) })\n' +
        '3. Use provider directly: const sdk = e2b({...}); await sdk.sandbox.create()'
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

  private registerSandboxProvider(sandbox: SandboxInterface, provider: DirectProvider): void {
    const sandboxId = getSandboxId(sandbox);
    if (sandboxId) {
      this.sandboxProviders.set(sandboxId, provider);
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

  private getByIdCandidates(sandboxId: string): DirectProvider[] {
    const known = this.sandboxProviders.get(sandboxId);
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

  private getSnapshotCreateCandidates(sandboxId: string, preferredProviderName?: string): DirectProvider[] {
    if (preferredProviderName) {
      return [this.getProviderByName(preferredProviderName)];
    }

    const known = this.sandboxProviders.get(sandboxId);
    const providers = this.getProviders().filter((p) => !!p.snapshot);

    if (known && known.snapshot) {
      return [known, ...providers.filter((p) => p !== known)];
    }

    return providers;
  }

  private getVolumeCreateCandidates(preferredProviderName?: string): DirectProvider[] {
    const providers = this.getProviders().filter((p) => typeof p.volume?.create === 'function');
    if (preferredProviderName) {
      const preferred = this.getProviderByName(preferredProviderName);
      if (typeof preferred.volume?.create !== 'function') {
        throw new Error(`Provider "${preferredProviderName}" does not support volume creation.`);
      }
      return [preferred];
    }
    return providers;
  }

  private getVolumeListProviders(): DirectProvider[] {
    return this.getProviders().filter((p) => typeof p.volume?.list === 'function');
  }

  private async identifyVolumeOwner(volumeId: string): Promise<{ provider: DirectProvider; volume: Volume } | undefined> {
    const providers = this.getProviders().filter((p) => typeof p.volume?.getById === 'function');
    let owner: { provider: DirectProvider; volume: Volume } | undefined;
    const errors: Error[] = [];

    for (const provider of providers) {
      try {
        const volume = await provider.volume!.getById!(volumeId);
        if (volume) {
          if (owner) {
            throw new VolumeAmbiguityError(
              `Volume id "${volumeId}" is ambiguous: found on providers "${getProviderLabel(owner.provider, 0)}" and "${getProviderLabel(provider, 1)}". ` +
              'Pass the provider name in options to disambiguate.'
            );
          }
          if (errors.length > 0) {
            throw new VolumeLookupAggregateError(
              `Volume id "${volumeId}" owner lookup could not be established because other providers reported errors: ` +
              errors.map((e) => e.message).join('; ')
            );
          }
          owner = { provider, volume };
        }
      } catch (error) {
        if (error instanceof VolumeAmbiguityError || error instanceof VolumeLookupAggregateError) {
          throw error;
        }
        if (isVolumeNotFoundError(error)) {
          // Volume is absent on this provider; keep searching.
          continue;
        }
        errors.push(error instanceof Error ? error : new Error(String(error)));
      }
    }

    if (errors.length > 0) {
      throw new VolumeLookupAggregateError(
        `Volume id "${volumeId}" owner lookup failed: ` + errors.map((e) => e.message).join('; ')
      );
    }

    return owner;
  }

  private async resolveVolumeOwner(
    volumeId: string,
    preferredProviderName?: string
  ): Promise<{ provider: DirectProvider; volume: Volume } | undefined> {
    if (preferredProviderName) {
      const provider = this.getProviderByName(preferredProviderName);
      if (!provider.volume?.getById) {
        throw new Error(`Provider "${preferredProviderName}" does not support volume lookup.`);
      }
      const volume = await provider.volume.getById(volumeId);
      if (volume) {
        return { provider, volume };
      }
      return undefined;
    }

    return this.identifyVolumeOwner(volumeId);
  }

  private async createWithFallback(options?: CreateSandboxOptions): Promise<SandboxInterface> {
    const preferredProviderName = options?.provider;
    const { provider: _providerName, ...providerOptions } = options || {};
    const candidates = this.getCreateCandidates(preferredProviderName);
    const canFallback = this.fallbackOnError && !preferredProviderName;
    const errors: string[] = [];

    for (const [index, provider] of candidates.entries()) {
      try {
        const sandbox = await provider.sandbox.create(providerOptions);
        this.registerSandboxProvider(sandbox, provider);
        return sandbox;
      } catch (error) {
        // AbortErrors should not be treated as provider failures; rethrow immediately
        if (error instanceof Error && (error as any).name === 'AbortError') {
          throw error;
        }
        errors.push(`${getProviderLabel(provider, index)}: ${getProviderErrorDetail(error)}`);
        if (!canFallback) {
          throw error;
        }
      }
    }

    throw new Error(
      `Failed to create sandbox across ${candidates.length} provider(s).\n` +
      errors.map((error) => `- ${error}`).join('\n')
    );
  }

  setConfig(config: ExplicitComputeConfig): void {
    this.providers = resolveProviders(config);
    this.providerStrategy = config.providerStrategy ?? 'priority';
    this.fallbackOnError = config.fallbackOnError ?? true;
    this.roundRobinCursor = 0;
    this.sandboxProviders.clear();
    this.snapshotProviders.clear();
  }

  sandbox = {
    create: async (options?: CreateSandboxOptions): Promise<SandboxInterface> => {
      return this.createWithFallback(options);
    },

    getById: async (sandboxId: string): Promise<SandboxInterface | null> => {
      for (const provider of this.getByIdCandidates(sandboxId)) {
        const sandbox = await provider.sandbox.getById(sandboxId);
        if (sandbox) {
          this.registerSandboxProvider(sandbox, provider);
          return sandbox;
        }
      }

      this.sandboxProviders.delete(sandboxId);
      return null;
    },

    list: async (): Promise<SandboxInterface[]> => {
      const all: SandboxInterface[] = [];

      for (const provider of this.getProviders()) {
        if (!provider.sandbox.list) {
          continue;
        }

        const sandboxes = await provider.sandbox.list();
        for (const sandbox of sandboxes) {
          this.registerSandboxProvider(sandbox, provider);
        }
        all.push(...sandboxes);
      }

      return all;
    },

    destroy: async (sandboxId: string): Promise<void> => {
      const candidates = this.getByIdCandidates(sandboxId);
      const errors: string[] = [];

      for (const [index, provider] of candidates.entries()) {
        try {
          await provider.sandbox.destroy(sandboxId);
          this.sandboxProviders.delete(sandboxId);
          return;
        } catch (error) {
          errors.push(`${getProviderLabel(provider, index)}: ${getProviderErrorDetail(error)}`);
        }
      }

      throw new Error(
        `Failed to destroy sandbox "${sandboxId}" across ${candidates.length} provider(s).\n` +
        errors.map((error) => `- ${error}`).join('\n')
      );
    },
  };

  snapshot = {
    create: async (sandboxId: string, options?: CreateSnapshotOptions): Promise<{ id: string; provider: string; createdAt: Date; metadata?: Record<string, any> }> => {
      const preferredProviderName = options?.provider;
      const { provider: _providerName, ...providerOptions } = options || {};
      const candidates = this.getSnapshotCreateCandidates(sandboxId, preferredProviderName);
      const errors: string[] = [];

      for (const [index, provider] of candidates.entries()) {
        if (!provider.snapshot) {
          errors.push(`${getProviderLabel(provider, index)}: snapshots not supported`);
          continue;
        }

        try {
          const snapshot = await provider.snapshot.create(sandboxId, providerOptions);
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
        `Failed to create snapshot for sandbox "${sandboxId}" across ${candidates.length} provider(s).\n` +
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

  volume = {
    create: async (options?: CreateVolumeOptions): Promise<Volume> => {
      const preferredProviderName = options?.provider;
      const { provider: _providerName, ...providerOptions } = options || {};
      const candidates = this.getVolumeCreateCandidates(preferredProviderName);
      const errors: string[] = [];

      for (const [index, provider] of candidates.entries()) {
        if (!provider.volume?.create) continue;

        try {
          const volume = await provider.volume.create(providerOptions);
          return volume;
        } catch (error) {
          errors.push(`${getProviderLabel(provider, index)}: ${getProviderErrorDetail(error)}`);
          if (preferredProviderName) throw error;
        }
      }

      throw new Error(
        `Failed to create volume across ${candidates.length} provider(s).\n` +
        errors.map((error) => `- ${error}`).join('\n')
      );
    },

    list: async (options?: ListVolumesOptions): Promise<Volume[]> => {
      const preferredProviderName = options?.provider;
      const { provider: _providerName, ...providerOptions } = options || {};
      const providers = preferredProviderName
        ? [this.getProviderByName(preferredProviderName)]
        : this.getVolumeListProviders();
      const volumes: Volume[] = [];
      const errors: string[] = [];
      const limit = options?.limit;
      let remaining = typeof limit === 'number' && limit >= 0 ? limit : undefined;

      for (const [index, provider] of providers.entries()) {
        if (!provider.volume?.list) continue;
        if (remaining !== undefined && remaining <= 0) break;

        const callOptions = { ...providerOptions };
        if (remaining !== undefined) {
          callOptions.limit = remaining;
        }

        try {
          const listed = await provider.volume.list(callOptions);
          for (const volume of listed) {
            volumes.push(volume);
            if (remaining !== undefined) {
              remaining--;
              if (remaining <= 0) {
                return volumes.slice(0, limit);
              }
            }
          }
        } catch (error) {
          errors.push(`${getProviderLabel(provider, index)}: ${getProviderErrorDetail(error)}`);
        }
      }

      return volumes;
    },

    getById: async (volumeId: string): Promise<Volume | null> => {
      const result = await this.resolveVolumeOwner(volumeId);
      return result?.volume ?? null;
    },

    delete: async (volumeId: string, options?: DeleteVolumeOptions): Promise<void> => {
      const preferredProviderName = options?.provider;
      const result = await this.resolveVolumeOwner(volumeId, preferredProviderName);

      if (!result) {
        throw new Error(
          `Cannot determine which provider owns volume "${volumeId}". ` +
          'Pass the provider name in options: ' +
          '`compute.volume.delete("' + volumeId + '", { provider: "e2b" })`'
        );
      }

      const owner = result.provider;

      if (!owner.volume?.delete) {
        throw new Error(`Provider "${owner.name ?? 'unknown'}" does not support volume deletion.`);
      }

      try {
        await owner.volume.delete(volumeId);
      } catch (error) {
        throw new Error(
          `Failed to delete volume "${volumeId}" with provider "${owner.name ?? 'unknown'}".\n` +
          `${getProviderErrorDetail(error)}`
        );
      }
    },

    attach: async (volumeId: string, sandboxId: string, options?: AttachVolumeOptions): Promise<void> => {
      const preferredProviderName = options?.provider;
      const { provider: _providerName, ...providerOptions } = options || {};
      const result = await this.resolveVolumeOwner(volumeId, preferredProviderName);

      if (!result) {
        throw new Error(
          `Cannot determine which provider owns volume "${volumeId}". ` +
          'Pass the provider name in options: ' +
          '`compute.volume.attach("' + volumeId + '", "' + sandboxId + '", { provider: "createos-sandbox" })`'
        );
      }

      const owner = result.provider;

      if (!owner.volume?.attach) {
        throw new Error(`Provider "${owner.name ?? 'unknown'}" does not support volume attachment.`);
      }

      try {
        await owner.volume.attach(volumeId, sandboxId, providerOptions);
      } catch (error) {
        throw new Error(
          `Failed to attach volume "${volumeId}" to sandbox "${sandboxId}" with provider "${owner.name ?? 'unknown'}".\n` +
          `${getProviderErrorDetail(error)}`
        );
      }
    },

    detach: async (volumeId: string, sandboxId: string, options?: AttachVolumeOptions): Promise<void> => {
      const preferredProviderName = options?.provider;
      const { provider: _providerName, ...providerOptions } = options || {};
      const result = await this.resolveVolumeOwner(volumeId, preferredProviderName);

      if (!result) {
        throw new Error(
          `Cannot determine which provider owns volume "${volumeId}". ` +
          'Pass the provider name in options: ' +
          '`compute.volume.detach("' + volumeId + '", "' + sandboxId + '", { provider: "createos-sandbox" })`'
        );
      }

      const owner = result.provider;

      if (!owner.volume?.detach) {
        throw new Error(`Provider "${owner.name ?? 'unknown'}" does not support volume detachment.`);
      }

      try {
        await owner.volume.detach(volumeId, sandboxId, providerOptions);
      } catch (error) {
        throw new Error(
          `Failed to detach volume "${volumeId}" from sandbox "${sandboxId}" with provider "${owner.name ?? 'unknown'}".\n` +
          `${getProviderErrorDetail(error)}`
        );
      }
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
