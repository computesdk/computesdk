/**
 * Servers - Resource namespace for managed server operations
 */

import type {
  ServersListResponse,
  ServerResponse,
  ServerStopResponse,
  ServerInfo,
  ServerStatus,
} from '../index';

/**
 * Servers resource namespace
 *
 * @example
 * ```typescript
 * // Start a new server
 * const server = await sandbox.servers.start({
 *   slug: 'api',
 *   command: 'npm start',
 *   path: '/app',
 * });
 *
 * // List all servers
 * const servers = await sandbox.servers.list();
 *
 * // Retrieve a specific server
 * const server = await sandbox.servers.retrieve('api');
 *
 * // Stop a server
 * await sandbox.servers.stop('api');
 *
 * // Restart a server
 * await sandbox.servers.restart('api');
 * ```
 */
export class Servers {
  private startHandler: (options: {
    slug: string;
    command: string;
    path?: string;
    env_file?: string;
  }) => Promise<ServerResponse>;
  private listHandler: () => Promise<ServersListResponse>;
  private retrieveHandler: (slug: string) => Promise<ServerResponse>;
  private stopHandler: (slug: string) => Promise<ServerStopResponse | void>;
  private restartHandler: (slug: string) => Promise<ServerResponse>;
  private updateStatusHandler: (slug: string, status: ServerStatus) => Promise<void>;

  constructor(handlers: {
    start: (options: {
      slug: string;
      command: string;
      path?: string;
      env_file?: string;
    }) => Promise<ServerResponse>;
    list: () => Promise<ServersListResponse>;
    retrieve: (slug: string) => Promise<ServerResponse>;
    stop: (slug: string) => Promise<ServerStopResponse | void>;
    restart: (slug: string) => Promise<ServerResponse>;
    updateStatus: (slug: string, status: ServerStatus) => Promise<void>;
  }) {
    this.startHandler = handlers.start;
    this.listHandler = handlers.list;
    this.retrieveHandler = handlers.retrieve;
    this.stopHandler = handlers.stop;
    this.restartHandler = handlers.restart;
    this.updateStatusHandler = handlers.updateStatus;
  }

  /**
   * Start a new managed server
   * @param options - Server configuration
   * @param options.slug - Unique server slug (URL-safe identifier)
   * @param options.command - Command to start the server
   * @param options.path - Working directory (optional)
   * @param options.env_file - Path to env file (optional)
   * @returns Server info
   */
  async start(options: {
    slug: string;
    command: string;
    path?: string;
    env_file?: string;
  }): Promise<ServerInfo> {
    const response = await this.startHandler(options);
    return response.data.server;
  }

  /**
   * List all managed servers
   * @returns Array of server info
   */
  async list(): Promise<ServerInfo[]> {
    const response = await this.listHandler();
    return response.data.servers;
  }

  /**
   * Retrieve a specific server by slug
   * @param slug - The server slug
   * @returns Server info
   */
  async retrieve(slug: string): Promise<ServerInfo> {
    const response = await this.retrieveHandler(slug);
    return response.data.server;
  }

  /**
   * Stop a server by slug
   * @param slug - The server slug
   */
  async stop(slug: string): Promise<void> {
    await this.stopHandler(slug);
  }

  /**
   * Restart a server by slug
   * @param slug - The server slug
   * @returns Server info
   */
  async restart(slug: string): Promise<ServerInfo> {
    const response = await this.restartHandler(slug);
    return response.data.server;
  }

  /**
   * Update server status (internal use)
   * @param slug - The server slug
   * @param status - New status
   */
  async updateStatus(slug: string, status: ServerStatus): Promise<void> {
    await this.updateStatusHandler(slug, status);
  }
}
