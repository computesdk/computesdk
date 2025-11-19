/**
 * Provider Types
 * 
 * Types related to provider configuration, authentication, and resource management
 */

import type { Sandbox, CreateSandboxOptions, Runtime } from './sandbox';

/**
 * Common options for creating snapshots
 */
export interface CreateSnapshotOptions {
  /** Optional name for the snapshot */
  name?: string;
  /** Optional metadata for the snapshot */
  metadata?: Record<string, string>;
}

/**
 * Common options for listing snapshots
 */
export interface ListSnapshotsOptions {
  /** Filter by sandbox ID */
  sandboxId?: string;
  /** Limit the number of results */
  limit?: number;
}

/**
 * Common options for creating templates/blueprints
 */
export interface CreateTemplateOptions {
  /** Name of the template */
  name: string;
  /** Optional description */
  description?: string;
  /** Optional metadata for the template */
  metadata?: Record<string, string>;
}

/**
 * Common options for listing templates
 */
export interface ListTemplatesOptions {
  /** Limit the number of results */
  limit?: number;
}

/**
 * Provider sandbox manager interface - handles sandbox lifecycle
 */
export interface ProviderSandboxManager<TSandbox = any> {
  /** Create a new sandbox */
  create(options?: CreateSandboxOptions): Promise<Sandbox<TSandbox>>;
  /** Get an existing sandbox by ID */
  getById(sandboxId: string): Promise<Sandbox<TSandbox> | null>;
  /** List all active sandboxes */
  list(): Promise<Sandbox<TSandbox>[]>;
  /** Destroy a sandbox */
  destroy(sandboxId: string): Promise<void>;
}

/**
 * Provider template manager interface - handles template/blueprint lifecycle
 */
export interface ProviderTemplateManager<TTemplate = any> {
  /** Create a new template */
  create(options: CreateTemplateOptions | any): Promise<TTemplate>;
  /** List all available templates */
  list(options?: ListTemplatesOptions): Promise<TTemplate[]>;
  /** Delete a template */
  delete(templateId: string): Promise<void>;
}

/**
 * Provider snapshot manager interface - handles snapshot lifecycle
 */
export interface ProviderSnapshotManager<TSnapshot = any> {
  /** Create a snapshot from a sandbox */
  create(sandboxId: string, options?: CreateSnapshotOptions): Promise<TSnapshot>;
  /** List all snapshots */
  list(options?: ListSnapshotsOptions): Promise<TSnapshot[]>;
  /** Delete a snapshot */
  delete(snapshotId: string): Promise<void>;
}

/**
 * Provider interface - creates and manages resources
 */
export interface Provider<TSandbox = any, TTemplate = any, TSnapshot = any> {
  /** Provider name/type */
  readonly name: string;
  
  /** Sandbox management operations */
  readonly sandbox: ProviderSandboxManager<TSandbox>;
  
  /** Optional template management operations */
  readonly template?: ProviderTemplateManager<TTemplate>;
  
  /** Optional snapshot management operations */
  readonly snapshot?: ProviderSnapshotManager<TSnapshot>;
  
  /** Get the list of supported runtime environments */
  getSupportedRuntimes(): Runtime[];
  
  /** Phantom type property for TypeScript inference - not used at runtime */
  readonly __sandboxType: TSandbox;
  
  // Future resource managers will be added here:
  // readonly blob: ProviderBlobManager;
  // readonly git: ProviderGitManager;
  // readonly domains: ProviderDomainManager;
}

/**
 * Configuration for the compute singleton
 */
export interface ComputeConfig<TProvider extends Provider = Provider> {
  /** Default provider to use when none is specified */
  defaultProvider?: TProvider;
  /** @deprecated Use defaultProvider instead. Kept for backwards compatibility */
  provider?: TProvider;
  /** API key for compute CLI authentication */
  apiKey?: string;
  /** Access token for compute CLI authentication */
  accessToken?: string;
  /** @deprecated Use accessToken instead. Kept for backwards compatibility */
  jwt?: string;
}

/**
 * Parameters for compute.sandbox.create()
 */
export interface CreateSandboxParams {
  /** Provider instance to use */
  provider: Provider;  
  /** Optional sandbox creation options */
  options?: CreateSandboxOptions;
}

/**
 * Parameters for compute.sandbox.create() with optional provider
 */
export interface CreateSandboxParamsWithOptionalProvider {
  /** Provider instance to use (optional if default is set) */
  provider?: Provider;
  /** Optional sandbox creation options */
  options?: CreateSandboxOptions;
}

/**
 * Base Compute API interface (non-generic)
 */
export interface ComputeAPI {
  /** Configuration management */
  setConfig<TProvider extends Provider>(config: ComputeConfig<TProvider>): void;
  getConfig(): ComputeConfig | null;
  clearConfig(): void;
  
  sandbox: {
    /** Create a sandbox from a provider (or default provider if configured) */
    create(params?: CreateSandboxParams | CreateSandboxParamsWithOptionalProvider): Promise<Sandbox>;
    /** Get an existing sandbox by ID from a provider (or default provider if configured) */
    getById(providerOrSandboxId: Provider | string, sandboxId?: string): Promise<Sandbox | null>;
    /** List all active sandboxes from a provider (or default provider if configured) */
    list(provider?: Provider): Promise<Sandbox[]>;
    /** Destroy a sandbox via a provider (or default provider if configured) */
    destroy(providerOrSandboxId: Provider | string, sandboxId?: string): Promise<void>;
  };
  
  // Future resource APIs will be added here:
  // blob: ProviderBlobAPI;
  // git: ProviderGitAPI;
  // domains: ProviderDomainAPI;
}

/**
 * Typed Compute API interface that preserves provider type information
 * When auth (apiKey/accessToken) is configured, returns enhanced sandboxes with ComputeClient features
 */
export interface TypedComputeAPI<TProvider extends Provider, TIsEnhanced extends boolean = boolean> extends Omit<ComputeAPI, 'sandbox' | 'setConfig'> {
  /** Configuration management that returns typed compute instance */
  setConfig<T extends Provider>(config: ComputeConfig<T>): TypedComputeAPI<T>;

  sandbox: {
    /** Create a sandbox from the configured provider with proper typing */
    create(params?: Omit<CreateSandboxParamsWithOptionalProvider, 'provider'>): Promise<
      TIsEnhanced extends true
        ? import('./sandbox').TypedEnhancedSandbox<TProvider>
        : import('./sandbox').TypedSandbox<TProvider>
    >;
    /** Get an existing sandbox by ID from the configured provider with proper typing */
    getById(sandboxId: string): Promise<
      TIsEnhanced extends true
        ? import('./sandbox').TypedEnhancedSandbox<TProvider>
        : import('./sandbox').TypedSandbox<TProvider>
      | null
    >;
    /** List all active sandboxes from the configured provider with proper typing */
    list(): Promise<
      TIsEnhanced extends true
        ? import('./sandbox').TypedEnhancedSandbox<TProvider>[]
        : import('./sandbox').TypedSandbox<TProvider>[]
    >;
    /** Destroy a sandbox via the configured provider */
    destroy(sandboxId: string): Promise<void>;
  };
}

