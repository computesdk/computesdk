/**
 * Provider Types
 * 
 * Types related to provider configuration, authentication, and resource management
 */

import type { ComputeKind, CreateInstanceOptions, InstanceInterface } from 'computesdk';

/**
 * Provider Instance - what provider implementations return
 *
 * Extends the universal Instance interface with provider-specific methods.
 * Covers every compute form: sandbox, VM, baremetal.
 */
export interface ProviderInstance<TInstance = any> extends Omit<InstanceInterface, 'runCode'> {
  /** Get the provider that created this instance */
  getProvider(): Provider<TInstance>;
  /** Get the native provider instance */
  getInstance(): TInstance;
  /** Destroy instance and clean up resources */
  destroy(): Promise<void>;
}

/** @deprecated Use {@link ProviderInstance} instead. */
export type ProviderSandbox<TInstance = any> = ProviderInstance<TInstance>;

/**
 * Extract the instance type from a provider using generic inference
 */
export type ExtractProviderInstanceType<TProvider> = TProvider extends Provider<infer TInstance, any, any> ? TInstance : any;

/** @deprecated Use {@link ExtractProviderInstanceType} instead. */
export type ExtractProviderSandboxType<TProvider> = ExtractProviderInstanceType<TProvider>;

/**
 * Typed provider instance interface that preserves the provider's native instance type
 */
export type TypedProviderInstance<TProvider extends Provider> = ProviderInstance<ExtractProviderInstanceType<TProvider>>;

/** @deprecated Use {@link TypedProviderInstance} instead. */
export type TypedProviderSandbox<TProvider extends Provider> = TypedProviderInstance<TProvider>;

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
  /** Filter by instance ID */
  instanceId?: string;
  /** @deprecated Use {@link ListSnapshotsOptions.instanceId} instead. */
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
 * Provider instance manager interface - handles instance lifecycle
 */
export interface ProviderInstanceManager<TInstance = any> {
  /** Create a new instance */
  create(options?: CreateInstanceOptions): Promise<ProviderInstance<TInstance>>;
  /** Get an existing instance by ID */
  getById(instanceId: string): Promise<ProviderInstance<TInstance> | null>;
  /** List all active instances */
  list(): Promise<ProviderInstance<TInstance>[]>;
  /** Destroy an instance */
  destroy(instanceId: string): Promise<void>;
}

/** @deprecated Use {@link ProviderInstanceManager} instead. */
export type ProviderSandboxManager<TInstance = any> = ProviderInstanceManager<TInstance>;

/**
 * Provider template manager interface - handles template/blueprint lifecycle
 */
export interface ProviderTemplateManager<TTemplate = any, TCreateOptions extends CreateTemplateOptions = CreateTemplateOptions> {
  /** Create a new template */
  create(options: TCreateOptions): Promise<TTemplate>;
  /** List all available templates */
  list(options?: ListTemplatesOptions): Promise<TTemplate[]>;
  /** Delete a template */
  delete(templateId: string): Promise<void>;
}

/**
 * Provider snapshot manager interface - handles snapshot lifecycle
 */
export interface ProviderSnapshotManager<TSnapshot = any> {
  /** Create a snapshot from an instance */
  create(instanceId: string, options?: CreateSnapshotOptions): Promise<TSnapshot>;
  /** List all snapshots */
  list(options?: ListSnapshotsOptions): Promise<TSnapshot[]>;
  /** Delete a snapshot */
  delete(snapshotId: string): Promise<void>;
}

/**
 * Provider interface - creates and manages resources
 */
export interface Provider<TInstance = any, TTemplate = any, TSnapshot = any> {
  /** Provider name/type */
  readonly name: string;

  /** The form of compute this provider provisions. Defaults to 'sandbox'. */
  readonly kind?: ComputeKind;

  /** Instance management operations */
  readonly instances: ProviderInstanceManager<TInstance>;

  /**
   * @deprecated Use `instances`. Kept for backwards compatibility; always
   * the same manager object as `instances`.
   */
  readonly sandbox: ProviderInstanceManager<TInstance>;

  /** Optional template management operations */
  readonly template?: ProviderTemplateManager<TTemplate>;

  /** Optional snapshot management operations */
  readonly snapshot?: ProviderSnapshotManager<TSnapshot>;

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
 * Parameters for compute.instances.create()
 */
export interface CreateInstanceParams {
  /** Provider instance to use */
  provider: Provider;
  /** Optional instance creation options */
  options?: CreateInstanceOptions;
}

/** @deprecated Use {@link CreateInstanceParams} instead. */
export type CreateSandboxParams = CreateInstanceParams;

/**
 * Parameters for compute.instances.create() with optional provider
 */
export interface CreateInstanceParamsWithOptionalProvider {
  /** Provider instance to use (optional if default is set) */
  provider?: Provider;
  /** Optional instance creation options */
  options?: CreateInstanceOptions;
}

/** @deprecated Use {@link CreateInstanceParamsWithOptionalProvider} instead. */
export type CreateSandboxParamsWithOptionalProvider = CreateInstanceParamsWithOptionalProvider;

/**
 * Base Compute API interface (non-generic)
 *
 * Returns ProviderInstance which is the common interface for all instances.
 */
export interface ComputeAPI {
  /** Configuration management */
  setConfig<TProvider extends Provider>(config: ComputeConfig<TProvider>): void;
  getConfig(): ComputeConfig | null;
  clearConfig(): void;

  instances: {
    /** Create an instance from a provider (or default provider if configured) */
    create(params?: CreateInstanceParams | CreateInstanceParamsWithOptionalProvider): Promise<ProviderInstance>;
    /** Get an existing instance by ID from a provider (or default provider if configured) */
    getById(providerOrInstanceId: Provider | string, instanceId?: string): Promise<ProviderInstance | null>;
    /** List all active instances from a provider (or default provider if configured) */
    list(provider?: Provider): Promise<ProviderInstance[]>;
    /** Destroy an instance via a provider (or default provider if configured) */
    destroy(providerOrInstanceId: Provider | string, instanceId?: string): Promise<void>;
  };

  /** @deprecated Use `instances`. Always the same manager object. */
  sandbox: ComputeAPI['instances'];

  // Future resource APIs will be added here:
  // blob: ProviderBlobAPI;
  // git: ProviderGitAPI;
  // domains: ProviderDomainAPI;
}

/**
 * Typed Compute API interface that preserves provider type information
 */
export interface TypedComputeAPI<TProvider extends Provider> extends Omit<ComputeAPI, 'instances' | 'sandbox' | 'setConfig'> {
  /** Configuration management that returns typed compute instance */
  setConfig<T extends Provider>(config: ComputeConfig<T>): TypedComputeAPI<T>;

  instances: {
    /** Create an instance from the configured provider with proper typing */
    create(params?: Omit<CreateInstanceParamsWithOptionalProvider, 'provider'>): Promise<
      TypedProviderInstance<TProvider>
    >;
    /** Get an existing instance by ID from the configured provider with proper typing */
    getById(instanceId: string): Promise<
      TypedProviderInstance<TProvider> | null
    >;
    /** List all active instances from the configured provider with proper typing */
    list(): Promise<TypedProviderInstance<TProvider>[]>;
    /** Destroy an instance via the configured provider */
    destroy(instanceId: string): Promise<void>;
  };

  /** @deprecated Use `instances`. Always the same manager object. */
  sandbox: TypedComputeAPI<TProvider>['instances'];
}

/**
 * E2B provider configuration for explicit compute mode
 */
export interface E2BProviderConfig {
  /** E2B API key */
  apiKey?: string;
  /** E2B project ID */
  projectId?: string;
  /** E2B environment/template ID */
  templateId?: string;
}

/**
 * Modal provider configuration for explicit compute mode
 */
export interface ModalProviderConfig {
  /** Modal token ID */
  tokenId?: string;
  /** Modal token secret */
  tokenSecret?: string;
}

/**
 * Railway provider configuration for explicit compute mode
 */
export interface RailwayProviderConfig {
  /** Railway API token */
  apiToken?: string;
  /** Railway project ID */
  projectId?: string;
  /** Railway environment ID */
  environmentId?: string;
}

/**
 * Daytona provider configuration for explicit compute mode
 */
export interface DaytonaProviderConfig {
  /** Daytona API key */
  apiKey?: string;
}

/**
 * Vercel provider configuration for explicit compute mode
 */
export interface VercelProviderConfig {
  /** Vercel OIDC token (preferred, simpler auth) */
  oidcToken?: string;
  /** Vercel API token (traditional auth) */
  token?: string;
  /** Vercel team ID (required with token) */
  teamId?: string;
  /** Vercel project ID (required with token) */
  projectId?: string;
}

/**
 * Runloop provider configuration for explicit compute mode
 */
export interface RunloopProviderConfig {
  /** Runloop API key */
  apiKey?: string;
}

/**
 * Cloudflare provider configuration for explicit compute mode
 */
export interface CloudflareProviderConfig {
  /** Cloudflare API token */
  apiToken?: string;
  /** Cloudflare account ID */
  accountId?: string;
}

/**
 * CodeSandbox provider configuration for explicit compute mode
 */
export interface CodesandboxProviderConfig {
  /** CodeSandbox API key */
  apiKey?: string;
}

/**
 * Blaxel provider configuration for explicit compute mode
 */
export interface BlaxelProviderConfig {
  /** Blaxel API key */
  apiKey?: string;
  /** Blaxel workspace */
  workspace?: string;
}

// Note: Gateway-specific types (ExplicitComputeConfig, etc.) are in computesdk package

/**
 * Storage Provider Types
 * 
 * Unified interface for object storage providers (S3, R2, Tigris, etc.)
 */

/**
 * Storage object metadata
 */
export interface StorageObject {
  /** Bucket name */
  bucket: string;
  /** Object key/path */
  key: string;
  /** Object size in bytes */
  size: number;
  /** ETag (entity tag) for the object */
  etag?: string;
  /** Last modified date */
  lastModified?: Date;
  /** Optional metadata */
  metadata?: Record<string, string>;
}

/**
 * Options for uploading objects
 */
export interface UploadOptions {
  /** MIME content type */
  contentType?: string;
  /** Custom metadata */
  metadata?: Record<string, string>;
}

/**
 * Result from a download operation
 */
export interface DownloadResult {
  /** Object data as Uint8Array (cross-platform compatible) */
  data: Uint8Array;
  /** Object size in bytes */
  size: number;
  /** MIME content type */
  contentType?: string;
  /** ETag (entity tag) */
  etag?: string;
  /** Last modified date */
  lastModified?: Date;
  /** Custom metadata */
  metadata?: Record<string, string>;
}

/**
 * Options for listing objects
 */
export interface ListOptions {
  /** Prefix to filter objects */
  prefix?: string;
  /** Maximum number of keys to return */
  maxKeys?: number;
  /** Continuation token for pagination */
  continuationToken?: string;
}

/**
 * Result from a list operation
 */
export interface ListResult {
  /** List of objects */
  objects: StorageObject[];
  /** Whether there are more results */
  truncated: boolean;
  /** Continuation token for next page */
  continuationToken?: string;
}

/**
 * Base storage provider interface
 * 
 * All storage providers (S3, R2, Tigris) implement this interface
 */
export interface StorageProvider {
  /** Upload data to storage */
  upload(bucket: string, key: string, data: Uint8Array | string, options?: UploadOptions): Promise<StorageObject>;
  /** Download data from storage */
  download(bucket: string, key: string): Promise<DownloadResult>;
  /** Delete object from storage */
  delete(bucket: string, key: string): Promise<void>;
  /** List objects in bucket */
  list(bucket: string, options?: ListOptions): Promise<ListResult>;
}
