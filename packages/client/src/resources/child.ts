/**
 * Child - Resource namespace for child sandbox operations
 */

import type { SandboxInfo, SandboxesListResponse } from '../index';

/**
 * Child resource namespace for managing child sandboxes
 *
 * Child sandboxes are isolated environments within the parent sandbox,
 * each with their own filesystem. Available only in multi-tenant mode.
 *
 * @example
 * ```typescript
 * // Create a new child sandbox
 * const child = await sandbox.child.create();
 * console.log(child.url); // https://sandbox-12345.preview.computesdk.com
 *
 * // List all children
 * const all = await sandbox.child.list();
 *
 * // Get a specific child
 * const info = await sandbox.child.retrieve('sandbox-12345');
 *
 * // Delete a child sandbox
 * await sandbox.child.destroy('sandbox-12345');
 *
 * // Delete child and its files
 * await sandbox.child.destroy('sandbox-12345', { deleteFiles: true });
 * ```
 */
export class Child {
  private createHandler: () => Promise<SandboxInfo>;
  private listHandler: () => Promise<SandboxesListResponse>;
  private retrieveHandler: (subdomain: string) => Promise<SandboxInfo>;
  private destroyHandler: (subdomain: string, deleteFiles: boolean) => Promise<void>;

  constructor(handlers: {
    create: () => Promise<SandboxInfo>;
    list: () => Promise<SandboxesListResponse>;
    retrieve: (subdomain: string) => Promise<SandboxInfo>;
    destroy: (subdomain: string, deleteFiles: boolean) => Promise<void>;
  }) {
    this.createHandler = handlers.create;
    this.listHandler = handlers.list;
    this.retrieveHandler = handlers.retrieve;
    this.destroyHandler = handlers.destroy;
  }

  /**
   * Create a new child sandbox
   * @returns Child sandbox info including URL and subdomain
   */
  async create(): Promise<SandboxInfo> {
    return this.createHandler();
  }

  /**
   * List all child sandboxes
   * @returns Array of child sandbox info
   */
  async list(): Promise<SandboxInfo[]> {
    const response = await this.listHandler();
    return response.sandboxes;
  }

  /**
   * Retrieve a specific child sandbox by subdomain
   * @param subdomain - The child subdomain (e.g., 'sandbox-12345')
   * @returns Child sandbox info
   */
  async retrieve(subdomain: string): Promise<SandboxInfo> {
    return this.retrieveHandler(subdomain);
  }

  /**
   * Destroy (delete) a child sandbox
   * @param subdomain - The child subdomain
   * @param options - Destroy options
   * @param options.deleteFiles - Whether to delete the child's files (default: false)
   */
  async destroy(
    subdomain: string,
    options?: { deleteFiles?: boolean }
  ): Promise<void> {
    return this.destroyHandler(subdomain, options?.deleteFiles ?? false);
  }
}
