/**
 * Watchers - Resource namespace for file watcher operations
 */

import type { FileWatcher } from '../file-watcher';
import type { WatchersListResponse, WatcherResponse, WatcherInfo } from '../index';

/**
 * Watchers resource namespace
 *
 * @example
 * ```typescript
 * // Create a file watcher
 * const watcher = await sandbox.watchers.create('/project', {
 *   ignored: ['node_modules', '.git'],
 *   includeContent: true,
 * });
 * watcher.on('change', (event) => {
 *   console.log(`${event.event}: ${event.path}`);
 * });
 *
 * // List all watchers
 * const watchers = await sandbox.watchers.list();
 *
 * // Retrieve a specific watcher
 * const watcher = await sandbox.watchers.retrieve(id);
 *
 * // Destroy a watcher
 * await sandbox.watchers.destroy(id);
 * ```
 */
export class Watchers {
  private createHandler: (
    path: string,
    options?: {
      includeContent?: boolean;
      ignored?: string[];
      encoding?: 'raw' | 'base64';
    }
  ) => Promise<FileWatcher>;
  private listHandler: () => Promise<WatchersListResponse>;
  private retrieveHandler: (id: string) => Promise<WatcherResponse>;
  private destroyHandler: (id: string) => Promise<void>;

  constructor(handlers: {
    create: (
      path: string,
      options?: {
        includeContent?: boolean;
        ignored?: string[];
        encoding?: 'raw' | 'base64';
      }
    ) => Promise<FileWatcher>;
    list: () => Promise<WatchersListResponse>;
    retrieve: (id: string) => Promise<WatcherResponse>;
    destroy: (id: string) => Promise<void>;
  }) {
    this.createHandler = handlers.create;
    this.listHandler = handlers.list;
    this.retrieveHandler = handlers.retrieve;
    this.destroyHandler = handlers.destroy;
  }

  /**
   * Create a new file watcher
   * @param path - Path to watch
   * @param options - Watcher options
   * @param options.includeContent - Include file content in change events
   * @param options.ignored - Patterns to ignore
   * @param options.encoding - Encoding: 'raw' (default) or 'base64' (binary-safe)
   * @returns FileWatcher instance
   */
  async create(
    path: string,
    options?: {
      includeContent?: boolean;
      ignored?: string[];
      encoding?: 'raw' | 'base64';
    }
  ): Promise<FileWatcher> {
    return this.createHandler(path, options);
  }

  /**
   * List all active file watchers
   * @returns Array of watcher info
   */
  async list(): Promise<WatcherInfo[]> {
    const response = await this.listHandler();
    return response.data.watchers;
  }

  /**
   * Retrieve a specific watcher by ID
   * @param id - The watcher ID
   * @returns Watcher info
   */
  async retrieve(id: string): Promise<WatcherInfo> {
    const response = await this.retrieveHandler(id);
    return response.data;
  }

  /**
   * Destroy a watcher by ID
   * @param id - The watcher ID
   */
  async destroy(id: string): Promise<void> {
    return this.destroyHandler(id);
  }
}
