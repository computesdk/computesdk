/**
 * Provider Types
 * 
 * Types related to provider configuration, authentication, and resource management
 */

import type { Runtime, CreateSandboxOptions, SandboxInterface } from 'computesdk';

/**
 * Provider Sandbox - what provider implementations return
 * 
 * Extends the universal Sandbox interface with provider-specific methods
 */
export interface ProviderSandbox<TSandbox = any> extends SandboxInterface {
  /** Get the provider that created this sandbox */
  getProvider(): Provider<TSandbox>;
  /** Get the native provider sandbox instance */
  getInstance(): TSandbox;
  /** Destroy sandbox and clean up resources */
  destroy(): Promise<void>;
}

/**
 * Extract the sandbox type from a provider using generic inference
 */
export type ExtractProviderSandboxType<TProvider> = TProvider extends Provider<infer TSandbox, any, any> ? TSandbox : any;

/**
 * Typed provider sandbox interface that preserves the provider's native instance type
 */
export type TypedProviderSandbox<TProvider extends Provider> = ProviderSandbox<ExtractProviderSandboxType<TProvider>>;

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
  create(options?: CreateSandboxOptions): Promise<ProviderSandbox<TSandbox>>;
  /** Get an existing sandbox by ID */
  getById(sandboxId: string): Promise<ProviderSandbox<TSandbox> | null>;
  /** List all active sandboxes */
  list(): Promise<ProviderSandbox<TSandbox>[]>;
  /** Destroy a sandbox */
  destroy(sandboxId: string): Promise<void>;
}

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
 *
 * Returns ProviderSandbox which is the common interface for all sandboxes.
 */
export interface ComputeAPI {
  /** Configuration management */
  setConfig<TProvider extends Provider>(config: ComputeConfig<TProvider>): void;
  getConfig(): ComputeConfig | null;
  clearConfig(): void;

  sandbox: {
    /** Create a sandbox from a provider (or default provider if configured) */
    create(params?: CreateSandboxParams | CreateSandboxParamsWithOptionalProvider): Promise<ProviderSandbox>;
    /** Get an existing sandbox by ID from a provider (or default provider if configured) */
    getById(providerOrSandboxId: Provider | string, sandboxId?: string): Promise<ProviderSandbox | null>;
    /** List all active sandboxes from a provider (or default provider if configured) */
    list(provider?: Provider): Promise<ProviderSandbox[]>;
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
 */
export interface TypedComputeAPI<TProvider extends Provider> extends Omit<ComputeAPI, 'sandbox' | 'setConfig'> {
  /** Configuration management that returns typed compute instance */
  setConfig<T extends Provider>(config: ComputeConfig<T>): TypedComputeAPI<T>;

  sandbox: {
    /** Create a sandbox from the configured provider with proper typing */
    create(params?: Omit<CreateSandboxParamsWithOptionalProvider, 'provider'>): Promise<
      TypedProviderSandbox<TProvider>
    >;
    /** Get an existing sandbox by ID from the configured provider with proper typing */
    getById(sandboxId: string): Promise<
      TypedProviderSandbox<TProvider> | null
    >;
    /** List all active sandboxes from the configured provider with proper typing */
    list(): Promise<TypedProviderSandbox<TProvider>[]>;
    /** Destroy a sandbox via the configured provider */
    destroy(sandboxId: string): Promise<void>;
  };
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

