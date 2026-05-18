/**
 * Compute API - Direct Provider Implementation
 *
 * `compute` delegates to one or more configured provider instances directly.
 */

import type {
  Sandbox as SandboxInterface,
  CreateSandboxOptions as UniversalCreateSandboxOptions,
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

export interface DirectProvider {
  readonly name?: string;
  readonly sandbox: ProviderSandboxManager;
  readonly snapshot?: ProviderSnapshotManager;
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
  /** Benchmark-grade anonymized telemetry */
  telemetry?: TelemetryConfig;
}

export interface BenchmarkAttempt {
  provider: string;
  candidateIndex: number;
  startedAt: string;
  endedAt: string;
  durationMs: number;
  outcome: 'success' | 'failure';
  errorCode?: string;
}

export interface TelemetryEvent {
  eventName: 'telemetry.config' | 'telemetry.span';
  installId: string;
  traceId?: string;
  spanId?: string;
  parentSpanId?: string;
  operation?: string;
  startedAt?: string;
  endedAt?: string;
  durationMs?: number;
  outcome?: 'success' | 'failure';
  provider?: string;
  attemptCount?: number;
  attempts?: BenchmarkAttempt[];
  errorCode?: string;
  sdkVersion?: string;
  runtime?: 'node' | 'browser' | 'unknown';
  os?: string;
  arch?: string;
  providerStrategy?: 'priority' | 'round-robin';
  fallbackOnError?: boolean;
}

export interface TelemetryConfig {
  enabled?: boolean;
  endpoint?: string;
  headers?: Record<string, string>;
  sdkVersion?: string;
  onEvent?: (event: TelemetryEvent) => void;
}

function createInstallId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function telemetryDisabledByEnv(): boolean {
  return typeof process !== 'undefined' && process?.env?.COMPUTESDK_TELEMETRY === '0';
}

function toErrorCode(error: unknown): string {
  if (error instanceof Error && error.name) {
    return error.name;
  }
  return 'ERROR';
}

class ComputeTelemetry {
  private enabled = true;
  private endpoint?: string;
  private headers: Record<string, string> = {};
  private onEvent?: (event: TelemetryEvent) => void;
  private installId = createInstallId();
  private sdkVersion = 'unknown';
  private runtime: 'node' | 'browser' | 'unknown' = this.resolveRuntime();
  private os = this.resolveOs();
  private arch = this.resolveArch();

  configure(config?: TelemetryConfig): void {
    this.enabled = (config?.enabled ?? true) && !telemetryDisabledByEnv();
    this.endpoint = config?.endpoint;
    this.headers = config?.headers ?? {};
    this.sdkVersion = config?.sdkVersion ?? this.sdkVersion;
    this.onEvent = config?.onEvent;
  }

  emitConfig(config: { providerStrategy: 'priority' | 'round-robin'; fallbackOnError: boolean }): void {
    this.send({
      eventName: 'telemetry.config',
      installId: this.installId,
      sdkVersion: this.sdkVersion,
      runtime: this.runtime,
      os: this.os,
      arch: this.arch,
      providerStrategy: config.providerStrategy,
      fallbackOnError: config.fallbackOnError,
    });
  }

  createSpan(operation: string, parentSpanId?: string): BenchmarkSpan {
    return {
      traceId: createInstallId(),
      spanId: createInstallId(),
      parentSpanId,
      operation,
      startedAtMs: Date.now(),
      startedAtIso: new Date().toISOString(),
      attempts: [],
    };
  }

  addAttempt(span: BenchmarkSpan, attempt: BenchmarkAttempt): void {
    span.attempts.push(attempt);
  }

  emitSpanSuccess(span: BenchmarkSpan, provider?: string): void {
    const endedAtMs = Date.now();
    this.send({
      eventName: 'telemetry.span',
      installId: this.installId,
      traceId: span.traceId,
      spanId: span.spanId,
      parentSpanId: span.parentSpanId,
      operation: span.operation,
      startedAt: span.startedAtIso,
      endedAt: new Date(endedAtMs).toISOString(),
      durationMs: endedAtMs - span.startedAtMs,
      outcome: 'success',
      provider,
      attemptCount: span.attempts.length,
      attempts: span.attempts,
      sdkVersion: this.sdkVersion,
      runtime: this.runtime,
      os: this.os,
      arch: this.arch,
    });
  }

  emitSpanFailure(span: BenchmarkSpan, error: unknown, provider?: string): void {
    const endedAtMs = Date.now();
    this.send({
      eventName: 'telemetry.span',
      installId: this.installId,
      traceId: span.traceId,
      spanId: span.spanId,
      parentSpanId: span.parentSpanId,
      operation: span.operation,
      startedAt: span.startedAtIso,
      endedAt: new Date(endedAtMs).toISOString(),
      durationMs: endedAtMs - span.startedAtMs,
      outcome: 'failure',
      provider,
      attemptCount: span.attempts.length,
      attempts: span.attempts,
      errorCode: toErrorCode(error),
      sdkVersion: this.sdkVersion,
      runtime: this.runtime,
      os: this.os,
      arch: this.arch,
    });
  }

  async track<T>(operation: string, provider: string | undefined, fn: (span: BenchmarkSpan) => Promise<T>): Promise<T> {
    const span = this.createSpan(operation);
    try {
      const result = await fn(span);
      this.emitSpanSuccess(span, provider);
      return result;
    } catch (error) {
      this.emitSpanFailure(span, error, provider);
      throw error;
    }
  }

  private resolveRuntime(): 'node' | 'browser' | 'unknown' {
    if (typeof window !== 'undefined') return 'browser';
    if (typeof process !== 'undefined') return 'node';
    return 'unknown';
  }

  private resolveOs(): string {
    if (typeof process !== 'undefined' && process.platform) {
      return process.platform;
    }
    return 'unknown';
  }

  private resolveArch(): string {
    if (typeof process !== 'undefined' && process.arch) {
      return process.arch;
    }
    return 'unknown';
  }

  private send(event: TelemetryEvent): void {
    if (!this.enabled) return;
    if (this.onEvent) {
      try {
        this.onEvent(event);
      } catch {
      }
    }
    if (!this.endpoint || typeof fetch === 'undefined') return;
    void fetch(this.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...this.headers,
      },
      body: JSON.stringify(event),
    }).catch(() => {
    });
  }
}

interface BenchmarkSpan {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  operation: string;
  startedAtMs: number;
  startedAtIso: string;
  attempts: BenchmarkAttempt[];
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
  private telemetry = new ComputeTelemetry();

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

  private async createWithFallbackAndSpan(span: BenchmarkSpan, options?: CreateSandboxOptions): Promise<SandboxInterface> {
    const preferredProviderName = options?.provider;
    const { provider: _providerName, ...providerOptions } = options || {};
    const candidates = this.getCreateCandidates(preferredProviderName);
    const canFallback = this.fallbackOnError && !preferredProviderName;
    const errors: string[] = [];

    for (const [index, provider] of candidates.entries()) {
      const attemptStartedAtMs = Date.now();
      try {
        const sandbox = await provider.sandbox.create(providerOptions);
        this.telemetry.addAttempt(span, {
          provider: getProviderLabel(provider, index),
          candidateIndex: index,
          startedAt: new Date(attemptStartedAtMs).toISOString(),
          endedAt: new Date().toISOString(),
          durationMs: Date.now() - attemptStartedAtMs,
          outcome: 'success',
        });
        this.registerSandboxProvider(sandbox, provider);
        return sandbox;
      } catch (error) {
        this.telemetry.addAttempt(span, {
          provider: getProviderLabel(provider, index),
          candidateIndex: index,
          startedAt: new Date(attemptStartedAtMs).toISOString(),
          endedAt: new Date().toISOString(),
          durationMs: Date.now() - attemptStartedAtMs,
          outcome: 'failure',
          errorCode: toErrorCode(error),
        });
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
    this.telemetry.configure(config.telemetry);
    this.telemetry.emitConfig({
      providerStrategy: this.providerStrategy,
      fallbackOnError: this.fallbackOnError,
    });
    this.roundRobinCursor = 0;
    this.sandboxProviders.clear();
    this.snapshotProviders.clear();
  }

  sandbox = {
    create: async (options?: CreateSandboxOptions): Promise<SandboxInterface> => {
      return this.telemetry.track('sandbox.create', options?.provider, async (span) => this.createWithFallbackAndSpan(span, options));
    },

    getById: async (sandboxId: string): Promise<SandboxInterface | null> => {
      return this.telemetry.track('sandbox.getById', undefined, async (span) => {
        for (const provider of this.getByIdCandidates(sandboxId)) {
          const attemptStartedAtMs = Date.now();
          const sandbox = await provider.sandbox.getById(sandboxId);
          this.telemetry.addAttempt(span, {
            provider: provider.name || 'unknown',
            candidateIndex: span.attempts.length,
            startedAt: new Date(attemptStartedAtMs).toISOString(),
            endedAt: new Date().toISOString(),
            durationMs: Date.now() - attemptStartedAtMs,
            outcome: sandbox ? 'success' : 'failure',
            errorCode: sandbox ? undefined : 'NOT_FOUND',
          });
          if (sandbox) {
            this.registerSandboxProvider(sandbox, provider);
            return sandbox;
          }
        }

        this.sandboxProviders.delete(sandboxId);
        return null;
      });
    },

    list: async (): Promise<SandboxInterface[]> => {
      return this.telemetry.track('sandbox.list', undefined, async (span) => {
        const all: SandboxInterface[] = [];

        for (const provider of this.getProviders()) {
          if (!provider.sandbox.list) {
            continue;
          }

          const attemptStartedAtMs = Date.now();
          const sandboxes = await provider.sandbox.list();
          this.telemetry.addAttempt(span, {
            provider: provider.name || 'unknown',
            candidateIndex: span.attempts.length,
            startedAt: new Date(attemptStartedAtMs).toISOString(),
            endedAt: new Date().toISOString(),
            durationMs: Date.now() - attemptStartedAtMs,
            outcome: 'success',
          });
          for (const sandbox of sandboxes) {
            this.registerSandboxProvider(sandbox, provider);
          }
          all.push(...sandboxes);
        }

        return all;
      });
    },

    destroy: async (sandboxId: string): Promise<void> => {
      return this.telemetry.track('sandbox.destroy', undefined, async (span) => {
        const candidates = this.getByIdCandidates(sandboxId);
        const errors: string[] = [];

        for (const [index, provider] of candidates.entries()) {
          const attemptStartedAtMs = Date.now();
          try {
            await provider.sandbox.destroy(sandboxId);
            this.telemetry.addAttempt(span, {
              provider: getProviderLabel(provider, index),
              candidateIndex: index,
              startedAt: new Date(attemptStartedAtMs).toISOString(),
              endedAt: new Date().toISOString(),
              durationMs: Date.now() - attemptStartedAtMs,
              outcome: 'success',
            });
            this.sandboxProviders.delete(sandboxId);
            return;
          } catch (error) {
            this.telemetry.addAttempt(span, {
              provider: getProviderLabel(provider, index),
              candidateIndex: index,
              startedAt: new Date(attemptStartedAtMs).toISOString(),
              endedAt: new Date().toISOString(),
              durationMs: Date.now() - attemptStartedAtMs,
              outcome: 'failure',
              errorCode: toErrorCode(error),
            });
            errors.push(`${getProviderLabel(provider, index)}: ${getProviderErrorDetail(error)}`);
          }
        }

        throw new Error(
          `Failed to destroy sandbox "${sandboxId}" across ${candidates.length} provider(s).\n` +
          errors.map((error) => `- ${error}`).join('\n')
        );
      });
    },
  };

  snapshot = {
    create: async (sandboxId: string, options?: CreateSnapshotOptions): Promise<{ id: string; provider: string; createdAt: Date; metadata?: Record<string, any> }> => {
      return this.telemetry.track('snapshot.create', options?.provider, async (span) => {
        const preferredProviderName = options?.provider;
        const { provider: _providerName, ...providerOptions } = options || {};
        const candidates = this.getSnapshotCreateCandidates(sandboxId, preferredProviderName);
        const errors: string[] = [];

        for (const [index, provider] of candidates.entries()) {
          if (!provider.snapshot) {
            errors.push(`${getProviderLabel(provider, index)}: snapshots not supported`);
            continue;
          }

          const attemptStartedAtMs = Date.now();
          try {
            const snapshot = await provider.snapshot.create(sandboxId, providerOptions);
            this.telemetry.addAttempt(span, {
              provider: getProviderLabel(provider, index),
              candidateIndex: index,
              startedAt: new Date(attemptStartedAtMs).toISOString(),
              endedAt: new Date().toISOString(),
              durationMs: Date.now() - attemptStartedAtMs,
              outcome: 'success',
            });
            this.snapshotProviders.set(snapshot.id, provider);
            return {
              ...snapshot,
              createdAt: new Date(snapshot.createdAt),
            };
          } catch (error) {
            this.telemetry.addAttempt(span, {
              provider: getProviderLabel(provider, index),
              candidateIndex: index,
              startedAt: new Date(attemptStartedAtMs).toISOString(),
              endedAt: new Date().toISOString(),
              durationMs: Date.now() - attemptStartedAtMs,
              outcome: 'failure',
              errorCode: toErrorCode(error),
            });
            errors.push(`${getProviderLabel(provider, index)}: ${getProviderErrorDetail(error)}`);
          }
        }

        throw new Error(
          `Failed to create snapshot for sandbox "${sandboxId}" across ${candidates.length} provider(s).\n` +
          errors.map((error) => `- ${error}`).join('\n')
        );
      });
    },

    list: async (): Promise<Array<{ id: string; provider: string; createdAt: Date; metadata?: Record<string, any> }>> => {
      return this.telemetry.track('snapshot.list', undefined, async (span) => {
        const snapshots: Array<{ id: string; provider: string; createdAt: Date; metadata?: Record<string, any> }> = [];

        for (const [index, provider] of this.getProviders().entries()) {
          if (!provider.snapshot) continue;
          const attemptStartedAtMs = Date.now();
          const listed = await provider.snapshot.list();
          this.telemetry.addAttempt(span, {
            provider: getProviderLabel(provider, index),
            candidateIndex: index,
            startedAt: new Date(attemptStartedAtMs).toISOString(),
            endedAt: new Date().toISOString(),
            durationMs: Date.now() - attemptStartedAtMs,
            outcome: 'success',
          });
          for (const snapshot of listed) {
            this.snapshotProviders.set(snapshot.id, provider);
            snapshots.push({
              ...snapshot,
              createdAt: new Date(snapshot.createdAt),
            });
          }
        }

        return snapshots;
      });
    },

    delete: async (snapshotId: string): Promise<void> => {
      return this.telemetry.track('snapshot.delete', undefined, async (span) => {
        const candidates = this.getSnapshotDeleteCandidates(snapshotId);
        const errors: string[] = [];

        for (const [index, provider] of candidates.entries()) {
          if (!provider.snapshot) continue;
          const attemptStartedAtMs = Date.now();
          try {
            await provider.snapshot.delete(snapshotId);
            this.telemetry.addAttempt(span, {
              provider: getProviderLabel(provider, index),
              candidateIndex: index,
              startedAt: new Date(attemptStartedAtMs).toISOString(),
              endedAt: new Date().toISOString(),
              durationMs: Date.now() - attemptStartedAtMs,
              outcome: 'success',
            });
            this.snapshotProviders.delete(snapshotId);
            return;
          } catch (error) {
            this.telemetry.addAttempt(span, {
              provider: getProviderLabel(provider, index),
              candidateIndex: index,
              startedAt: new Date(attemptStartedAtMs).toISOString(),
              endedAt: new Date().toISOString(),
              durationMs: Date.now() - attemptStartedAtMs,
              outcome: 'failure',
              errorCode: toErrorCode(error),
            });
            errors.push(`${getProviderLabel(provider, index)}: ${getProviderErrorDetail(error)}`);
          }
        }

        throw new Error(
          `Failed to delete snapshot "${snapshotId}" across ${candidates.length} provider(s).\n` +
          errors.map((error) => `- ${error}`).join('\n')
        );
      });
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
