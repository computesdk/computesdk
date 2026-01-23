/**
 * Server - Resource namespace for managed server operations
 */

import type {
  ServersListResponse,
  ServerResponse,
  ServerStopResponse,
  ServerLogsResponse,
  ServerInfo,
  ServerStatus,
  ServerLogStream,
  RestartPolicy,
} from '../index';
import type { CreateOverlayOptions } from './overlay';

/**
 * Options for starting a managed server
 */
export interface ServerStartOptions {
  /** Unique server identifier (URL-safe) */
  slug: string;
  /** Install command to run before starting (optional, runs blocking, e.g., "npm install") */
  install?: string;
  /** Command to start the server (e.g., "npm run dev") */
  start: string;
  /** Working directory (optional) */
  path?: string;
  /** Path to .env file relative to path (optional) */
  env_file?: string;
  /** Inline environment variables (merged with env_file if both provided) */
  environment?: Record<string, string>;
  /** Requested port number (preallocated before start) */
  port?: number;
  /** If true, fail instead of auto-incrementing when port is taken */
  strict_port?: boolean;
  /** Whether to auto-start the server on daemon boot (default: true) */
  autostart?: boolean;
  /** Inline overlay to create before starting the server */
  overlay?: Omit<CreateOverlayOptions, 'waitForCompletion'>;
  /** Additional overlays to create before starting the server */
  overlays?: Array<Omit<CreateOverlayOptions, 'waitForCompletion'>>;
  /** Overlay IDs this server depends on (waits for copy completion) */
  depends_on?: string[];
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
 *   start: 'npm start',
 *   path: '/app',
 * });
 *
 * // Start with install command (runs before start)
 * const server = await sandbox.server.start({
 *   slug: 'web',
 *   install: 'npm install',
 *   start: 'npm run dev',
 *   path: '/app',
 * });
 *
 * // Start with supervisor settings (auto-restart on failure)
 * const server = await sandbox.server.start({
 *   slug: 'web',
 *   start: 'node server.js',
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
 * // Delete a server config
 * await sandbox.server.delete('api');
 *
 * // Restart a server
 * await sandbox.server.restart('api');
 * ```
 */
/**
 * Options for retrieving server logs
 */
export interface ServerLogsOptions {
  /** Which output stream to return: 'stdout', 'stderr', or 'combined' (default) */
  stream?: ServerLogStream;
}

/**
 * Server logs info returned from the logs method
 */
export interface ServerLogsInfo {
  /** Server slug identifier */
  slug: string;
  /** Which stream was returned */
  stream: ServerLogStream;
  /** The captured logs */
  logs: string;
}

export class Server {
  private startHandler: (options: ServerStartOptions) => Promise<ServerResponse>;
  private listHandler: () => Promise<ServersListResponse>;
  private retrieveHandler: (slug: string) => Promise<ServerResponse>;
  private stopHandler: (slug: string) => Promise<ServerStopResponse | void>;
  private deleteHandler: (slug: string) => Promise<void>;
  private restartHandler: (slug: string) => Promise<ServerResponse>;
  private updateStatusHandler: (slug: string, status: ServerStatus) => Promise<void>;
  private logsHandler: (slug: string, options?: ServerLogsOptions) => Promise<ServerLogsResponse>;

  constructor(handlers: {
    start: (options: ServerStartOptions) => Promise<ServerResponse>;
    list: () => Promise<ServersListResponse>;
    retrieve: (slug: string) => Promise<ServerResponse>;
    stop: (slug: string) => Promise<ServerStopResponse | void>;
    delete: (slug: string) => Promise<void>;
    restart: (slug: string) => Promise<ServerResponse>;
    updateStatus: (slug: string, status: ServerStatus) => Promise<void>;
    logs: (slug: string, options?: ServerLogsOptions) => Promise<ServerLogsResponse>;
  }) {
    this.startHandler = handlers.start;
    this.listHandler = handlers.list;
    this.retrieveHandler = handlers.retrieve;
    this.stopHandler = handlers.stop;
    this.deleteHandler = handlers.delete;
    this.restartHandler = handlers.restart;
    this.updateStatusHandler = handlers.updateStatus;
    this.logsHandler = handlers.logs;
  }

  /**
   * Start a new managed server with optional supervisor settings
   *
   * **Install Phase:**
   * If `install` is provided, it runs blocking before `start` (e.g., "npm install").
   * The server status will be `installing` during this phase.
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
   *   start: 'npm run dev',
   *   path: '/app',
   * });
   *
   * // With install command
   * const server = await sandbox.server.start({
   *   slug: 'api',
   *   install: 'npm install',
   *   start: 'node server.js',
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
   * Stop a server by slug (non-destructive)
   * @param slug - The server slug
   */
  async stop(slug: string): Promise<void> {
    await this.stopHandler(slug);
  }

  /**
   * Delete a server config by slug (stops + removes persistence)
   * @param slug - The server slug
   */
  async delete(slug: string): Promise<void> {
    await this.deleteHandler(slug);
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

  /**
   * Retrieve captured output (logs) for a managed server
   * @param slug - The server slug
   * @param options - Options for log retrieval
   * @returns Server logs info
   *
   * @example
   * ```typescript
   * // Get combined logs (default)
   * const logs = await sandbox.server.logs('api');
   * console.log(logs.logs);
   *
   * // Get only stdout
   * const stdout = await sandbox.server.logs('api', { stream: 'stdout' });
   *
   * // Get only stderr
   * const stderr = await sandbox.server.logs('api', { stream: 'stderr' });
   * ```
   */
  async logs(slug: string, options?: ServerLogsOptions): Promise<ServerLogsInfo> {
    const response = await this.logsHandler(slug, options);
    return response.data;
  }
}
