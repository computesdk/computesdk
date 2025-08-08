/**
 * Sandbox Management - Provider-Centric Approach
 * 
 * No registry - providers are the single source of truth
 */

import type { Sandbox, Provider, CreateSandboxOptions } from './types';

/**
 * Sandbox manager - thin wrapper around provider APIs
 */
export class SandboxManager {
  /**
   * Create a sandbox from a provider
   */
  async create(provider: Provider, options?: CreateSandboxOptions): Promise<Sandbox> {
    // Provider creates and manages the sandbox - no local tracking
    return await provider.sandbox.create(options);
  }

  /**
   * Get an existing sandbox by ID from a provider
   */
  async getById(provider: Provider, sandboxId: string): Promise<Sandbox | null> {
    // Always fetch from provider API - provider is source of truth
    return await provider.sandbox.getById(sandboxId);
  }

  /**
   * List all active sandboxes from a provider
   */
  async list(provider: Provider): Promise<Sandbox[]> {
    // Always fetch from provider API - provider is source of truth
    return await provider.sandbox.list();
  }

  /**
   * Destroy a sandbox via a provider
   */
  async destroy(provider: Provider, sandboxId: string): Promise<void> {
    // Provider handles destruction - no local cleanup needed
    return await provider.sandbox.destroy(sandboxId);
  }
}