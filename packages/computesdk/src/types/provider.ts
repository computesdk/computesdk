/**
 * Provider Types
 * 
 * Types related to provider configuration, authentication, and resource management
 */

import type { Sandbox, CreateSandboxOptions } from './sandbox';

/**
 * Provider sandbox management interface
 */
export interface ProviderSandboxManager {
  /** Create a new sandbox */
  create(options?: CreateSandboxOptions): Promise<Sandbox>;
  /** Get an existing sandbox by ID */
  getById(sandboxId: string): Promise<Sandbox | null>;
  /** List all active sandboxes */
  list(): Promise<Sandbox[]>;
  /** Destroy a sandbox */
  destroy(sandboxId: string): Promise<void>;
}

/**
 * Provider interface - creates and manages resources
 */
export interface Provider {
  /** Provider name/type */
  readonly name: string;
  
  /** Sandbox management operations */
  readonly sandbox: ProviderSandboxManager;
  
  // Future resource managers will be added here:
  // readonly blob: ProviderBlobManager;
  // readonly git: ProviderGitManager;
  // readonly domains: ProviderDomainManager;
}

/**
 * Configuration for the compute singleton
 */
export interface ComputeConfig {
  /** Default provider to use when none is specified */
  provider: Provider;
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
 * Compute singleton interface
 */
export interface ComputeAPI {
  /** Configuration management */
  setConfig(config: ComputeConfig): void;
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