/**
 * Server - Resource namespace for managed server operations
 */

import type {
  ServersListResponse,
  ServerResponse,
  ServerStopResponse,
  ServerInfo,
  ServerStatus,
  RestartPolicy,
} from '../index';

/**
 * Options for starting a managed server
 */
export interface ServerStartOptions {
  /** Unique server identifier (URL-safe) */
  slug: string;
  /** Command to start the server */
  command: string;
  /** Working directory (optional) */
  path?: string;
  /** Path to .env file relative to path (optional) */
  env_file?: string;
  /** Inline environment variables (merged with env_file if both provided) */
  environment?: Record<string, string>;
  /**
   * When to automatically restart the server:
   * - `never`: No automatic restart (default)
   * - `on-failure`: Restart only on non-zero exit code
   * - `always`: Always restart on exit (including exit code 0)
   */
  restart_policy?: RestartPolicy;
  /** Maximum restart attempts (0 = unlimited, default: 0) */
  max_restarts?: number;
  /** Delay between restart attempts in milliseconds (default: 1000) */
  restart_delay_ms?: number;
  /** Graceful shutdown timeout in milliseconds - SIGTERM → wait → SIGKILL (default: 10000) */
  stop_timeout_ms?: number;
}

/**
 * Server resource namespace
 *
 * @example
 * ```typescript
 * // Start a basic server
 * const server = await sandbox.server.start({
 *   slug: 'api',
 *   command: 'npm start',
 *   path: '/app',
 * });
 *
 * // Start with supervisor settings (auto-restart on failure)
 * const server = await sandbox.server.start({
 *   slug: 'web',
 *   command: 'node server.js',
 *   path: '/app',
 *   environment: { NODE_ENV: 'production', PORT: '3000' },
 *   restart_policy: 'on-failure',
 *   max_restarts: 5,
 *   restart_delay_ms: 2000,
 * });
 *
 * // List all servers
 * const servers = await sandbox.server.list();
 *
 * // Retrieve a specific server
 * const server = await sandbox.server.retrieve('api');
 *
 * // Stop a server (graceful shutdown with SIGTERM → SIGKILL)
 * await sandbox.server.stop('api');
 *
 * // Restart a server
 * await sandbox.server.restart('api');
 * ```
 */
export class Server {
  private startHandler: (options: ServerStartOptions) => Promise<ServerResponse>;
  private listHandler: () => Promise<ServersListResponse>;
  private retrieveHandler: (slug: string) => Promise<ServerResponse>;
  private stopHandler: (slug: string) => Promise<ServerStopResponse | void>;
  private restartHandler: (slug: string) => Promise<ServerResponse>;
  private updateStatusHandler: (slug: string, status: ServerStatus) => Promise<void>;

  constructor(handlers: {
    start: (options: ServerStartOptions) => Promise<ServerResponse>;
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
   * Start a new managed server with optional supervisor settings
   *
   * **Restart Policies:**
   * - `never` (default): No automatic restart on exit
   * - `on-failure`: Restart only on non-zero exit code
   * - `always`: Always restart on exit (including exit code 0)
   *
   * **Graceful Shutdown:**
   * When stopping a server, it first sends SIGTERM and waits for `stop_timeout_ms`
   * before sending SIGKILL if the process hasn't exited.
   *
   * @param options - Server configuration
   * @returns Server info
   *
   * @example
   * ```typescript
   * // Basic server
   * const server = await sandbox.server.start({
   *   slug: 'web',
   *   command: 'npm run dev',
   *   path: '/app',
   * });
   *
   * // With supervisor settings
   * const server = await sandbox.server.start({
   *   slug: 'api',
   *   command: 'node server.js',
   *   environment: { NODE_ENV: 'production' },
   *   restart_policy: 'always',
   *   max_restarts: 0, // unlimited
   * });
   * ```
   */
  async start(options: ServerStartOptions): Promise<ServerInfo> {
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
