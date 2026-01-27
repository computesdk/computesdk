/**
 * ComputeSDK Client - Universal Sandbox Implementation
 *
 * This package provides a Sandbox for interacting with ComputeSDK sandboxes
 * through API endpoints at ${sandboxId}.sandbox.computesdk.com
 *
 * Works in browser, Node.js, and edge runtimes.
 * Browser: Uses native WebSocket and fetch
 * Node.js: Pass WebSocket implementation (e.g., 'ws' library)
 */

import { WebSocketManager } from './websocket';
import { TerminalInstance } from './terminal';
import { FileWatcher } from './file-watcher';
import { SignalService } from './signal-service';
import { escapeArgs, mkdir, test } from '@computesdk/cmd';

// Import resource namespaces
import {
  Terminal,
  Server,
  Watcher,
  SessionToken,
  MagicLink,
  Signal,
  File,
  Env,
  Auth,
  Run,
  Child,
  Overlay,
} from './resources';

// Re-export high-level classes and types
export { TerminalInstance } from './terminal';
/** @deprecated Use TerminalInstance instead */
export { TerminalInstance as Terminal } from './terminal';
export { FileWatcher, type FileChangeEvent } from './file-watcher';
export { SignalService, type PortSignalEvent, type ErrorSignalEvent, type SignalEvent } from './signal-service';
export { encodeBinaryMessage, decodeBinaryMessage, isBinaryData, blobToArrayBuffer, MessageType } from './protocol';

// Re-export resource types
export { Command } from './resources/command';
export { TerminalCommand } from './resources/terminal-command';
export type { SessionTokenInfo } from './resources/session-token';
export type { MagicLinkInfo } from './resources/magic-link';
export type { SignalStatusInfo } from './resources/signal';
export type { AuthStatusInfo, AuthInfo, AuthEndpointsInfo } from './resources/auth';
export type { CodeResult, CommandResult, CodeLanguage, CodeRunOptions, CommandRunOptions, CommandWaitOptions } from './resources/run';
export type { ServerStartOptions, ServerLogsOptions, ServerLogsInfo } from './resources/server';
export type ReadyInfo = ReadyResponse;
export type { OverlayCopyStatus, OverlayStats, OverlayInfo, WaitForCompletionOptions, OverlayStrategy } from './resources/overlay';

// Import overlay types for internal use and re-export CreateOverlayOptions
import type {
  CreateOverlayOptions,
  OverlayResponse,
  OverlayListResponse,
} from './resources/overlay';
export type { CreateOverlayOptions };

// Import universal types
import type {
  SandboxFileSystem,
  CodeResult,
  CommandResult,
  Runtime,
  SandboxInfo as UniversalSandboxInfo,
} from '../types/universal-sandbox';

// Import command types for internal use
import type { CommandWaitOptions, CommandResult as RunCommandResult } from './resources/run';

/**
 * Maximum timeout in seconds supported by the tunnel for long-polling requests.
 * The tunnel uses X-Request-Timeout header to configure this.
 */
const MAX_TUNNEL_TIMEOUT_SECONDS = 300;

// Import client-specific types
import type {
  SandboxStatus,
  ProviderSandboxInfo,
  FileEntry as ClientFileEntry,
  CreateSandboxOptions,
} from './types';

import {
  CommandExitError,
  isCommandExitError,
} from './types';

// Re-export shared types (canonical definitions)
export type {
  Runtime,
  SandboxStatus,
  ProviderSandboxInfo,
  SandboxFileSystem,
};

/**
 * Extended filesystem interface with overlay support
 */
export interface ExtendedFileSystem extends SandboxFileSystem {
  /** Overlay operations for template directories */
  readonly overlay: Overlay;
}

export type {
  ClientFileEntry as FileEntry,
};

// Note: CodeResult and CommandResult are exported from ./resources/run

export {
  CommandExitError,
  isCommandExitError,
};

// Import universal Sandbox interface
import type { Sandbox as ISandbox } from '../types/universal-sandbox';

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * WebSocket constructor type
 */
export type WebSocketConstructor = new (url: string) => WebSocket;

/**
 * Configuration options for creating a Sandbox
 */
export interface SandboxConfig {
  /** API endpoint URL (e.g., https://sandbox-123.sandbox.computesdk.com). Optional in browser - can be auto-detected from URL query param or localStorage */
  sandboxUrl?: string;
  /** Sandbox ID */
  sandboxId: string;
  /** Provider name (e.g., 'e2b', 'gateway') */
  provider: string;
  /** Access token or session token for authentication. Optional in browser - can be auto-detected from URL query param or localStorage */
  token?: string;
  /** Optional headers to include with all requests */
  headers?: Record<string, string>;
  /** Request timeout in milliseconds (default: 30000) */
  timeout?: number;
  /** WebSocket implementation (optional, uses global WebSocket if not provided) */
  WebSocket?: WebSocketConstructor;
  /** WebSocket protocol: 'binary' (default, recommended) or 'json' (for debugging) */
  protocol?: 'json' | 'binary';
  /** Optional metadata associated with the sandbox */
  metadata?: Record<string, unknown>;
  /** 
   * Handler called when destroy() is invoked. 
   * If provided, this is called to destroy the sandbox (e.g., via gateway API).
   * If not provided, destroy() only disconnects the WebSocket.
   * @internal
   */
  destroyHandler?: () => Promise<void>;
}

/**
 * Health check response
 */
export interface HealthResponse {
  status: string;
  timestamp: string;
}

/**
 * Server info response
 */
export interface InfoResponse {
  message: string;
  data: {
    auth_enabled: boolean;
    main_subdomain: string;
    sandbox_count: number;
    sandbox_url: string;
    version: string;
  };
}

/**
 * Session token response
 */
export interface SessionTokenResponse {
  id: string;
  token: string;
  description?: string;
  createdAt: string;
  expiresAt: string;
  expiresIn: number;
}

/**
 * Session token list response
 */
export interface SessionTokenListResponse {
  message: string;
  data: {
    tokens: Array<{
      id: string;
      description?: string;
      created_at: string;
      expires_at: string;
      last_used_at?: string;
    }>;
  };
}

/**
 * Magic link response
 */
export interface MagicLinkResponse {
  message: string;
  data: {
    magic_url: string;
    expires_at: string;
    redirect_url: string;
  };
}

/**
 * Authentication status response
 */
export interface AuthStatusResponse {
  message: string;
  data: {
    authenticated: boolean;
    token_type?: 'access_token' | 'session_token';
    expires_at?: string;
  };
}

/**
 * Authentication information response
 */
export interface AuthInfoResponse {
  message: string;
  data: {
    message: string;
    instructions: string;
    endpoints: {
      create_session_token: string;
      list_session_tokens: string;
      get_session_token: string;
      revoke_session_token: string;
      create_magic_link: string;
      auth_status: string;
      auth_info: string;
    };
  };
}

/**
 * File information
 */
export interface FileInfo {
  name: string;
  path: string;
  size: number;
  is_dir: boolean;
  modified_at: string;
}

/**
 * Files list response
 */
export interface FilesListResponse {
  message: string;
  data: {
    files: FileInfo[];
    path: string;
  };
}

/**
 * File response
 */
export interface FileResponse {
  message: string;
  data: {
    file: FileInfo;
    content?: string;
  };
}

/**
 * Terminal response
 */
export interface TerminalResponse {
  message: string;
  data: {
    id: string;
    pty: boolean;
    status: 'running' | 'stopped' | 'ready' | 'active';
    channel?: string; // Only present for PTY mode (pty=true)
    ws_url?: string; // Only present for PTY mode (pty=true)
    encoding?: 'raw' | 'base64';
  };
}

/**
 * Command execution response (used by both /run/command and /terminals/{id}/execute)
 */
export interface CommandExecutionResponse {
  message: string;
  data: {
    terminal_id?: string;
    cmd_id?: string;
    command: string;
    stdout: string;
    stderr: string;
    exit_code?: number; // May not be present for background/streaming commands
    duration_ms?: number; // May not be present for background/streaming commands
    status?: 'running' | 'completed' | 'failed';
    channel?: string; // Present for streaming mode
    pty?: boolean; // Indicates terminal mode
  };
}

/**
 * Command details response
 */
export interface CommandDetailsResponse {
  message: string;
  data: {
    cmd_id: string;
    command: string;
    status: 'running' | 'completed' | 'failed';
    stdout: string;
    stderr: string;
    started_at: string;
    finished_at?: string;
    duration_ms?: number;
    exit_code?: number;
  };
}

/**
 * Command list item
 */
export interface CommandListItem {
  cmd_id: string;
  command: string;
  status: 'running' | 'completed' | 'failed';
  started_at: string;
  finished_at?: string;
  duration_ms?: number;
  exit_code?: number;
}

/**
 * Commands list response
 */
export interface CommandsListResponse {
  message: string;
  data: {
    commands: CommandListItem[];
    count: number;
  };
}

/**
 * Code execution response (POST /run/code)
 */
export interface CodeExecutionResponse {
  data: {
    output: string;
    exit_code: number;
    language: string;
  };
}



/**
 * File watcher information
 */
export interface WatcherInfo {
  id: string;
  path: string;
  includeContent: boolean;
  ignored: string[];
  status: 'active' | 'stopped';
  channel: string;
  encoding?: 'raw' | 'base64';
}

/**
 * File watcher response
 */
export interface WatcherResponse {
  message: string;
  data: WatcherInfo & {
    ws_url: string;
  };
}

/**
 * File watchers list response
 */
export interface WatchersListResponse {
  message: string;
  data: {
    watchers: WatcherInfo[];
  };
}

/**
 * Signal service response
 */
export interface SignalServiceResponse {
  message: string;
  data: {
    status: 'active' | 'stopped';
    channel: string;
    ws_url: string;
  };
}

/**
 * Port signal response
 */
export interface PortSignalResponse {
  message: string;
  data: {
    port: number;
    type: 'open' | 'close';
    url: string;
  };
}

/**
 * Generic signal response
 */
export interface GenericSignalResponse {
  message: string;
  data: {
    message: string;
  };
}

/**
 * Sandbox information
 */
export interface SandboxInfo {
  subdomain: string;
  directory: string;
  is_main: boolean;
  created_at: string;
  url: string;
  overlays?: SandboxOverlayInfo[];
  servers?: SandboxServerInfo[];
}

/**
 * Sandboxes list response
 */
export interface SandboxesListResponse {
  sandboxes: SandboxInfo[];
}

/**
 * Error response
 */
export interface ErrorResponse {
  error: string;
}

/**
 * Terminal response
 */
export interface TerminalResponse {
  message: string;
  data: {
    id: string;
    pty: boolean;
    status: 'running' | 'stopped' | 'ready' | 'active';
    channel?: string; // Only present for PTY mode (pty=true)
    ws_url?: string; // Only present for PTY mode (pty=true)
    encoding?: 'raw' | 'base64';
  };
}

/**
 * Server status types
 *
 * - `installing`: Running install command (e.g., npm install) before starting
 * - `starting`: Initial startup of the server process
 * - `running`: Server process is running
 * - `ready`: Server is running and ready to accept traffic
 * - `failed`: Server failed to start or encountered a fatal error
 * - `stopped`: Server was intentionally stopped
 * - `restarting`: Server is being automatically restarted by the supervisor
 */
export type ServerStatus = 'installing' | 'starting' | 'running' | 'ready' | 'failed' | 'stopped' | 'restarting';

/**
 * Server restart policy
 * - `never`: No automatic restart (default)
 * - `on-failure`: Restart only on non-zero exit code
 * - `always`: Always restart on exit (including exit code 0)
 */
export type RestartPolicy = 'never' | 'on-failure' | 'always';

/**
 * Health check configuration for servers
 * Polls the server to verify it's responding to requests
 */
export interface HealthCheckConfig {
  /** Path to poll for health checks (default: "/") */
  path?: string;
  /** Interval between health checks in milliseconds (default: 2000) */
  interval_ms?: number;
  /** Timeout for each health check request in milliseconds (default: 1500) */
  timeout_ms?: number;
  /** Delay before starting health checks after port detection in milliseconds (default: 5000) */
  delay_ms?: number;
}

/**
 * Health check status information returned from server
 */
export interface HealthCheckStatus {
  /** When the last health check was performed (ISO 8601) */
  last_check?: string;
  /** HTTP status code from the last health check */
  last_status?: number;
  /** Number of consecutive failed health checks */
  consecutive_failures: number;
}

/**
 * Server information
 */
export interface ServerInfo {
  /** Unique server identifier */
  slug: string;
  /** Install command (optional, runs blocking before start) */
  install?: string;
  /** Command used to start the server */
  start: string;
  /** Working directory path */
  path: string;
  /** Original path before resolution */
  original_path?: string;
  /** Path to .env file */
  env_file?: string;
  /** Inline environment variables */
  environment?: Record<string, string>;
  /** Whether to auto-start the server on daemon boot */
  autostart?: boolean;
  /** If true, port allocation is strict (no auto-increment) */
  strict_port?: boolean;
  /** Overlay IDs this server depends on */
  depends_on?: string[];
  /** Auto-detected port number (populated when port monitor detects listening port) */
  port?: number;
  /** Generated URL from subdomain + port (populated when port is detected) */
  url?: string;
  /** Server lifecycle status */
  status: ServerStatus;
  /** Process ID (direct process, not shell wrapper) */
  pid?: number;
  /** Configured restart policy */
  restart_policy?: RestartPolicy;
  /** Maximum restart attempts (0 = unlimited) */
  max_restarts?: number;
  /** Delay between restarts in nanoseconds (input uses milliseconds via restart_delay_ms) */
  restart_delay?: number;
  /** Graceful shutdown timeout in nanoseconds (input uses milliseconds via stop_timeout_ms) */
  stop_timeout?: number;
  /** Number of times the server has been automatically restarted */
  restart_count?: number;
  /** Last exit code (null if process is still running) */
  exit_code?: number | null;
  /** Health check configuration (if configured) */
  health_check?: HealthCheckConfig;
  /** Whether the server is healthy (only present if health_check is configured) */
  healthy?: boolean;
  /** Health check status details (only present if health_check is configured) */
  health_status?: HealthCheckStatus;
  /** When the server was created */
  created_at: string;
  /** When the server was last updated */
  updated_at: string;
}

/**
 * Sandbox server info returned by setup flows
 */
export interface SandboxServerInfo {
  slug: string;
  port?: number;
  url?: string;
  status: ServerStatus;
  /** Whether the server is healthy (only present if health_check is configured) */
  healthy?: boolean;
  /** Health check status details (only present if health_check is configured) */
  health_check?: HealthCheckStatus;
}

/**
 * Sandbox overlay info returned by setup flows
 */
export interface SandboxOverlayInfo {
  id: string;
  source: string;
  target: string;
  copy_status: string;
}

/**
 * Ready response (public endpoint)
 */
export interface ReadyResponse {
  /** Whether all servers have ports allocated (URLs available) */
  ready: boolean;
  /** Whether all servers with health checks are passing */
  healthy?: boolean;
  servers: SandboxServerInfo[];
  overlays: SandboxOverlayInfo[];
}

/**
 * Servers list response
 */
export interface ServersListResponse {
  status: string;
  message: string;
  data: {
    servers: ServerInfo[];
  };
}

/**
 * Server response
 */
export interface ServerResponse {
  status: string;
  message: string;
  data: {
    server: ServerInfo;
  };
}

/**
 * Server stop response
 */
export interface ServerStopResponse {
  status: string;
  message: string;
  data: {
    slug: string;
  };
}

/**
 * Server logs stream type
 */
export type ServerLogStream = 'stdout' | 'stderr' | 'combined';

/**
 * Server logs response
 */
export interface ServerLogsResponse {
  status: string;
  message: string;
  data: {
    slug: string;
    stream: ServerLogStream;
    logs: string;
  };
}

/**
 * Server status update response
 */
export interface ServerStatusUpdateResponse {
  status: string;
  message: string;
  data: {
    slug: string;
    status: ServerStatus;
  };
}

/**
 * Environment variables response
 */
export interface EnvGetResponse {
  status: string;
  message: string;
  data: {
    file: string;
    variables: Record<string, string>;
  };
}

/**
 * Environment set response
 */
export interface EnvSetResponse {
  status: string;
  message: string;
  data: {
    file: string;
    keys: string[];
  };
}

/**
 * Environment delete response
 */
export interface EnvDeleteResponse {
  status: string;
  message: string;
  data: {
    file: string;
    keys: string[];
  };
}

/**
 * Batch file operation type
 */
export type BatchFileOperation = 'write' | 'delete';

/**
 * Batch file operation request
 */
export interface BatchFileRequest {
  path: string;
  operation: BatchFileOperation;
  content?: string;
}

/**
 * Batch file operation result
 */
export interface BatchWriteResult {
  path: string;
  success: boolean;
  error?: string;
  file?: FileInfo;
}

/**
 * Batch file operation response
 */
export interface BatchWriteResponse {
  message: string;
  data: {
    results: BatchWriteResult[];
  };
}

// ============================================================================
// Sandbox
// ============================================================================

/**
 * Sandbox - Full-featured gateway sandbox implementation
 *
 * Provides complete feature set including:
 * - Interactive terminals (PTY and exec modes)
 * - Managed servers
 * - File watchers with real-time events
 * - Authentication (session tokens, magic links)
 * - Environment management
 * - Signal service for port/error events
 * - Child sandbox creation
 *
 * This is the most feature-rich implementation available.
 *
 * @example
 * ```typescript
 * import { Sandbox } from 'computesdk'
 *
 * // Pattern 1: Admin operations (requires access token)
 * const sandbox = new Sandbox({
 *   sandboxUrl: 'https://sandbox-123.sandbox.computesdk.com',
 *   token: accessToken, // From edge service
 * });
 *
 * // Create session token for delegated operations
 * const sessionToken = await sandbox.createSessionToken({
 *   description: 'My Application',
 *   expiresIn: 604800, // 7 days
 * });
 *
 * // Pattern 2: Delegated operations (binary protocol by default)
 * const sandbox2 = new Sandbox({
 *   sandboxUrl: 'https://sandbox-123.sandbox.computesdk.com',
 *   token: sessionToken.data.token,
 *   // protocol: 'binary' is the default (50-90% size reduction)
 * });
 *
 * // Execute a one-off command
 * const result = await sandbox.execute({ command: 'ls -la' });
 * console.log(result.data.stdout);
 *
 * // Run code
 * const codeResult = await sandbox.runCode('console.log("Hello!")', 'node');
 *
 * // Work with files
 * const files = await sandbox.listFiles('/home/project');
 * await sandbox.writeFile('/home/project/test.txt', 'Hello, World!');
 * const content = await sandbox.readFile('/home/project/test.txt');
 *
 * // Create a PTY terminal with real-time output (interactive shell)
 * const terminal = await sandbox.createTerminal({ pty: true });
 * terminal.on('output', (data) => console.log(data));
 * terminal.write('ls -la\n');
 * await terminal.destroy();
 *
 * // Create an exec terminal for command tracking
 * const execTerminal = await sandbox.createTerminal({ pty: false });
 * const result = await execTerminal.execute('npm install', { background: true });
 * const cmd = await sandbox.getCommand(execTerminal.getId(), result.data.cmd_id);
 * console.log(cmd.data.status); // "running" | "completed" | "failed"
 * await execTerminal.destroy();
 *
 * // Watch for file changes
 * const watcher = await sandbox.createWatcher('/home/project', {
 *   ignored: ['node_modules', '.git']
 * });
 * watcher.on('change', (event) => {
 *   console.log(`${event.event}: ${event.path}`);
 * });
 * await watcher.destroy();
 *
 * // Monitor system signals
 * const signals = await sandbox.startSignals();
 * signals.on('port', (event) => {
 *   console.log(`Port ${event.port} opened: ${event.url}`);
 * });
 * await signals.stop();
 *
 * // Clean up
 * await sandbox.disconnect();
 * ```
 */
export class Sandbox {
  readonly sandboxId: string;
  readonly provider: string;
  readonly filesystem: ExtendedFileSystem;

  // Resource namespaces (singular naming convention)
  readonly terminal: Terminal;
  readonly run: Run;
  readonly server: Server;
  readonly watcher: Watcher;
  readonly sessionToken: SessionToken;
  readonly magicLink: MagicLink;
  readonly signal: Signal;
  readonly file: File;
  readonly env: Env;
  readonly auth: Auth;
  readonly child: Child;

  private config: Required<Omit<SandboxConfig, 'WebSocket' | 'metadata' | 'destroyHandler'>> & { metadata?: Record<string, unknown>; destroyHandler?: () => Promise<void> };
  private _token: string | null = null;
  private _ws: WebSocketManager | null = null;
  private WebSocketImpl: WebSocketConstructor;
  private _terminals: Map<string, TerminalInstance> = new Map();

  constructor(config: SandboxConfig) {
    this.sandboxId = config.sandboxId;
    this.provider = config.provider;

    // Auto-detect sandbox_url and session_token from URL/localStorage in browser environments
    let sandboxUrlResolved = config.sandboxUrl;
    let tokenFromUrl: string | null = null;
    let sandboxUrlFromUrl: string | null = null;

    if (typeof window !== 'undefined' && window.location && typeof localStorage !== 'undefined') {
      const params = new URLSearchParams(window.location.search);

      // Check URL parameters
      tokenFromUrl = params.get('session_token');
      sandboxUrlFromUrl = params.get('sandbox_url');

      // Clean up URL if any params were found
      let urlChanged = false;
      if (tokenFromUrl) {
        params.delete('session_token');
        localStorage.setItem('session_token', tokenFromUrl);
        urlChanged = true;
      }
      if (sandboxUrlFromUrl) {
        params.delete('sandbox_url');
        localStorage.setItem('sandbox_url', sandboxUrlFromUrl);
        urlChanged = true;
      }

      if (urlChanged) {
        const search = params.toString() ? `?${params.toString()}` : '';
        const newUrl = `${window.location.pathname}${search}${window.location.hash}`;
        window.history.replaceState({}, '', newUrl);
      }

      // Resolve sandboxUrl: config > URL > localStorage
      if (!config.sandboxUrl) {
        sandboxUrlResolved = sandboxUrlFromUrl || localStorage.getItem('sandbox_url') || '';
      }
    }

    this.config = {
      sandboxUrl: (sandboxUrlResolved || '').replace(/\/$/, ''), // Remove trailing slash
      sandboxId: config.sandboxId || '',
      provider: config.provider || '',
      token: config.token || '',
      headers: config.headers || {},
      timeout: config.timeout || 30000,
      protocol: config.protocol || 'binary',
      metadata: config.metadata,
      destroyHandler: config.destroyHandler,
    };

    // Use provided WebSocket or fall back to global
    this.WebSocketImpl = config.WebSocket || (globalThis.WebSocket as any);

    if (!this.WebSocketImpl) {
      throw new Error(
        'WebSocket is not available. In Node.js, pass WebSocket implementation:\n' +
        'import WebSocket from "ws";\n' +
        'new Sandbox({ sandboxUrl: "...", WebSocket })'
      );
    }

    // Priority for token: config.token > URL > localStorage
    if (config.token) {
      this._token = config.token;
    } else if (tokenFromUrl) {
      this._token = tokenFromUrl;
    } else if (typeof window !== 'undefined' && typeof localStorage !== 'undefined') {
      this._token = localStorage.getItem('session_token');
    }

    // Initialize filesystem interface with overlay support
    this.filesystem = {
      readFile: async (path: string) => this.readFile(path),
      writeFile: async (path: string, content: string) => {
        await this.writeFile(path, content);
      },
      mkdir: async (path: string) => {
        await this.runCommand(escapeArgs(mkdir(path)));
      },
      readdir: async (path: string) => {
        const response = await this.listFiles(path);
        // Convert to universal FileEntry format
        return response.data.files.map(f => ({
          name: f.name,
          type: (f.is_dir ? 'directory' : 'file') as 'directory' | 'file',
          size: f.size,
          modified: new Date(f.modified_at)
        }));
      },
      exists: async (path: string) => {
        const result = await this.runCommand(escapeArgs(test.exists(path)));
        return result.exitCode === 0;
      },
      remove: async (path: string) => {
        await this.deleteFile(path);
      },
      overlay: new Overlay({
        create: async (options: CreateOverlayOptions) => this.createOverlay(options),
        list: async () => this.listOverlays(),
        retrieve: async (id: string) => this.getOverlay(id),
        destroy: async (id: string) => this.deleteOverlay(id),
      }),
    };

    // Initialize resource namespaces (singular naming convention)
    this.terminal = new Terminal({
      create: async (options) => this.createTerminal(options),
      list: async () => this.listTerminals(),
      retrieve: async (id) => this.getTerminal(id),
      destroy: async (id) => {
        await this.request<void>(`/terminals/${id}`, { method: 'DELETE' });
      },
    });

    this.run = new Run({
      code: async (code, options) => {
        const result = await this.runCodeRequest(code, options?.language);
        return {
          output: result.data.output,
          exitCode: result.data.exit_code,
          language: result.data.language,
        };
      },
      command: async (command, options) => {
        const result = await this.runCommandRequest({
          command,
          shell: options?.shell,
          background: options?.background,
          cwd: options?.cwd,
          env: options?.env
        });
        return {
          stdout: result.data.stdout,
          stderr: result.data.stderr,
          exitCode: result.data.exit_code ?? 0,
          durationMs: result.data.duration_ms ?? 0,
          // Include cmdId and terminalId for background commands
          cmdId: result.data.cmd_id,
          terminalId: result.data.terminal_id,
          status: result.data.status,
        };
      },
      wait: async (terminalId, cmdId, options) => {
        return this.waitForCommandCompletion(terminalId, cmdId, options);
      },
    });

    this.server = new Server({
      start: async (options) => this.startServer(options),
      list: async () => this.listServers(),
      retrieve: async (slug) => this.getServer(slug),
      stop: async (slug) => { await this.stopServer(slug); },
      delete: async (slug) => { await this.deleteServer(slug); },
      restart: async (slug) => this.restartServer(slug),
      updateStatus: async (slug, status) => { await this.updateServerStatus(slug, status); },
      logs: async (slug, options) => this.getServerLogs(slug, options),
    });

    this.watcher = new Watcher({
      create: async (path, options) => this.createWatcher(path, options),
      list: async () => this.listWatchers(),
      retrieve: async (id) => this.getWatcher(id),
      destroy: async (id) => {
        await this.request<void>(`/watchers/${id}`, { method: 'DELETE' });
      },
    });

    this.sessionToken = new SessionToken({
      create: async (options) => this.createSessionToken(options),
      list: async () => this.listSessionTokens(),
      retrieve: async (id) => this.getSessionToken(id),
      revoke: async (id) => this.revokeSessionToken(id),
    });

    this.magicLink = new MagicLink({
      create: async (options) => this.createMagicLink(options),
    });

    this.signal = new Signal({
      start: async () => this.startSignals(),
      status: async () => this.getSignalStatus(),
      stop: async () => {
        await this.request<void>('/signals/stop', { method: 'POST' });
      },
      emitPort: async (port, type, url) => this.emitPortSignal(port, type, url),
      emitError: async (message) => this.emitErrorSignal(message),
      emitServerReady: async (port, url) => this.emitServerReadySignal(port, url),
    });

    this.file = new File({
      create: async (path, content) => this.createFile(path, content),
      list: async (path) => this.listFiles(path),
      retrieve: async (path) => this.readFile(path),
      destroy: async (path) => this.deleteFile(path),
      batchWrite: async (files) => this.batchWriteFiles(files),
      exists: async (path) => this.checkFileExists(path),
    });

    this.env = new Env({
      retrieve: async (file) => this.getEnv(file),
      update: async (file, variables) => this.setEnv(file, variables),
      remove: async (file, keys) => this.deleteEnv(file, keys),
      exists: async (file) => this.checkEnvFile(file),
    });

    this.auth = new Auth({
      status: async () => this.getAuthStatus(),
      info: async () => this.getAuthInfo(),
    });

    this.child = new Child({
      create: async (options?: CreateSandboxOptions) => this.createSandbox(options),
      list: async () => this.listSandboxes(),
      retrieve: async (subdomain) => this.getSandbox(subdomain),
      destroy: async (subdomain, deleteFiles) => this.deleteSandbox(subdomain, deleteFiles),
    });
  }

  /**
   * Get or create internal WebSocket manager
   */
  private async ensureWebSocket(): Promise<WebSocketManager> {
    if (!this._ws || this._ws.getState() === 'closed') {
      this._ws = new WebSocketManager({
        url: this.getWebSocketUrl(),
        WebSocket: this.WebSocketImpl,
        autoReconnect: true,
        debug: false,
        protocol: this.config.protocol,
      });
      await this._ws.connect();
    }
    return this._ws;
  }

  /**
   * Create and configure a TerminalInstance from response data
   */
  private async hydrateTerminal(
    data: TerminalResponse['data'], 
    ws?: WebSocketManager | null
  ): Promise<TerminalInstance> {
    // Create TerminalInstance
    const terminal = new TerminalInstance(
      data.id,
      data.pty,
      data.status,
      data.channel || null,
      ws || null,
      data.encoding || 'raw'
    );

    // Set up terminal handlers
    const terminalId = data.id;

    terminal.setExecuteHandler(async (command: string, background?: boolean) => {
      return this.request<CommandExecutionResponse>(`/terminals/${terminalId}/execute`, {
        method: 'POST',
        body: JSON.stringify({ command, background }),
      });
    });

    terminal.setListCommandsHandler(async () => {
      return this.request<CommandsListResponse>(`/terminals/${terminalId}/commands`);
    });

    terminal.setRetrieveCommandHandler(async (cmdId: string) => {
      return this.request<CommandDetailsResponse>(`/terminals/${terminalId}/commands/${cmdId}`);
    });

    terminal.setWaitCommandHandler(async (cmdId: string, timeout?: number) => {
      const params = timeout ? new URLSearchParams({ timeout: timeout.toString() }) : '';
      const endpoint = `/terminals/${terminalId}/commands/${cmdId}/wait${params ? `?${params}` : ''}`;
      return this.request<CommandDetailsResponse>(endpoint);
    });

    terminal.setDestroyHandler(async () => {
      await this.request<void>(`/terminals/${terminalId}`, {
        method: 'DELETE',
      });
      this._terminals.delete(terminalId);
    });

    return terminal;
  }

  // ============================================================================
  // Private Helper Methods
  // ============================================================================

  private async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.config.timeout);

    try {
      const headers: Record<string, string> = {
        ...this.config.headers,
      };

      // Only set Content-Type if there's a body
      if (options.body) {
        headers['Content-Type'] = 'application/json';
      }

      // Add authentication if token is available
      if (this._token) {
        headers['Authorization'] = `Bearer ${this._token}`;
      }

      const response = await fetch(`${this.config.sandboxUrl}${endpoint}`, {
        ...options,
        headers: {
          ...headers,
          ...options.headers,
        },
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      // Handle 204 No Content
      if (response.status === 204) {
        return undefined as T;
      }

      // Get response text first, then parse JSON with better error handling
      const text = await response.text();
      let data: T;
      try {
        data = JSON.parse(text);
      } catch (jsonError) {
        throw new Error(
          `Failed to parse JSON response from ${endpoint}: ${jsonError instanceof Error ? jsonError.message : String(jsonError)}\n` +
          `Response body (first 200 chars): ${text.substring(0, 200)}${text.length > 200 ? '...' : ''}`
        );
      }

      if (!response.ok) {
        const error = (data as ErrorResponse).error || response.statusText;

        // Provide helpful error message for 403 on auth endpoints
        if (response.status === 403 && endpoint.startsWith('/auth/')) {
          if (endpoint.includes('/session_tokens') || endpoint.includes('/magic-links')) {
            throw new Error(
              `Access token required. This operation requires an access token, not a session token.\n` +
              `API request failed (${response.status}): ${error}`
            );
          }
        }

        throw new Error(`API request failed (${response.status}): ${error}`);
      }

      return data;
    } catch (error) {
      clearTimeout(timeoutId);

      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error(`Request timeout after ${this.config.timeout}ms`);
      }

      throw error;
    }
  }

  // ============================================================================
  // Health Check
  // ============================================================================

  /**
   * Check service health
   */
  async health(): Promise<HealthResponse> {
    return this.request<HealthResponse>('/health');
  }

  // ============================================================================
  // Authentication
  // ============================================================================

  /**
   * Create a session token (requires access token)
   *
   * Session tokens are delegated credentials that can authenticate API requests
   * without exposing your access token. Only access tokens can create session tokens.
   *
   * @param options - Token configuration
   * @throws {Error} 403 Forbidden if called with a session token
   */
  async createSessionToken(options?: {
    description?: string;
    expiresIn?: number; // seconds, default 7 days (604800)
  }): Promise<SessionTokenResponse> {
    return this.request<SessionTokenResponse>('/auth/session_tokens', {
      method: 'POST',
      body: JSON.stringify(options || {}),
    });
  }

  /**
   * List all session tokens (requires access token)
   *
   * @throws {Error} 403 Forbidden if called with a session token
   */
  async listSessionTokens(): Promise<SessionTokenListResponse> {
    return this.request<SessionTokenListResponse>('/auth/session_tokens');
  }

  /**
   * Get details of a specific session token (requires access token)
   *
   * @param tokenId - The token ID
   * @throws {Error} 403 Forbidden if called with a session token
   */
  async getSessionToken(tokenId: string): Promise<SessionTokenResponse> {
    return this.request<SessionTokenResponse>(`/auth/session_tokens/${tokenId}`);
  }

  /**
   * Revoke a session token (requires access token)
   *
   * @param tokenId - The token ID to revoke
   * @throws {Error} 403 Forbidden if called with a session token
   */
  async revokeSessionToken(tokenId: string): Promise<void> {
    return this.request<void>(`/auth/session_tokens/${tokenId}`, {
      method: 'DELETE',
    });
  }

  /**
   * Generate a magic link for browser authentication (requires access token)
   *
   * Magic links are one-time URLs that automatically create a session token
   * and set it as a cookie in the user's browser. This provides an easy way
   * to authenticate users in browser-based applications.
   *
   * The generated link:
   * - Expires after 5 minutes or first use (whichever comes first)
   * - Automatically creates a new session token (7 day expiry)
   * - Sets the session token as an HttpOnly cookie
   * - Redirects to the specified URL
   *
   * @param options - Magic link configuration
   * @throws {Error} 403 Forbidden if called with a session token
   */
  async createMagicLink(options?: {
    redirectUrl?: string; // default: /play/
  }): Promise<MagicLinkResponse> {
    return this.request<MagicLinkResponse>('/auth/magic-links', {
      method: 'POST',
      body: JSON.stringify(options || {}),
    });
  }

  /**
   * Check authentication status
   * Does not require authentication
   */
  async getAuthStatus(): Promise<AuthStatusResponse> {
    return this.request<AuthStatusResponse>('/auth/status');
  }

  /**
   * Get authentication information and usage instructions
   * Does not require authentication
   */
  async getAuthInfo(): Promise<AuthInfoResponse> {
    return this.request<AuthInfoResponse>('/auth/info');
  }

  /**
   * Set authentication token manually
   * @param token - Access token or session token
   */
  setToken(token: string): void {
    this._token = token;
  }

  /**
   * Get current authentication token
   */
  getToken(): string | null {
    return this._token;
  }

  /**
   * Get current sandbox URL
   */
  getSandboxUrl(): string {
    return this.config.sandboxUrl;
  }

  // ============================================================================
  // Command Execution
  // ============================================================================

  /**
   * Execute a one-off command without creating a persistent terminal
   * 
   * @example
   * ```typescript
   * // Synchronous execution (waits for completion)
   * const result = await sandbox.execute({ command: 'npm test' });
   * console.log(result.data.exit_code);
   * 
   * // Background execution (returns immediately)
   * const result = await sandbox.execute({ 
   *   command: 'npm install',
   *   background: true 
   * });
   * // Use result.data.terminal_id and result.data.cmd_id to track
   * const cmd = await sandbox.getCommand(result.data.terminal_id!, result.data.cmd_id!);
   * ```
   */
  async execute(options: {
    command: string;
    shell?: string;
    background?: boolean;
  }): Promise<CommandExecutionResponse> {
    return this.request<CommandExecutionResponse>('/execute', {
      method: 'POST',
      body: JSON.stringify(options),
    });
  }

  /**
   * Execute code with automatic language detection (POST /run/code)
   *
   * @param code - The code to execute
   * @param language - Programming language (optional - auto-detects if not specified)
   * @returns Code execution result with output, exit code, and detected language
   *
   * @example
   * ```typescript
   * // Auto-detect language
   * const result = await sandbox.runCodeRequest('print("Hello")');
   * console.log(result.data.output); // "Hello\n"
   * console.log(result.data.language); // "python"
   *
   * // Explicit language
   * const result = await sandbox.runCodeRequest('console.log("Hi")', 'node');
   * ```
   */
  async runCodeRequest(code: string, language?: string): Promise<CodeExecutionResponse> {
    const body: { code: string; language?: string } = { code };
    if (language) {
      body.language = language;
    }
    return this.request<CodeExecutionResponse>('/run/code', {
      method: 'POST',
      body: JSON.stringify(body),
    });
  }

  /**
   * Execute a command and get the result
   * Lower-level method that returns the raw API response
   *
   * @param options.command - Command to execute
   * @param options.shell - Shell to use (optional)
   * @param options.background - Run in background (optional)
   * @param options.cwd - Working directory for the command (optional)
   * @param options.env - Environment variables (optional)
   * @returns Command execution result
   *
   * @example
   * ```typescript
   * const result = await sandbox.runCommandRequest({ command: 'ls -la' });
   * console.log(result.data.stdout);
   * ```
   */
  async runCommandRequest(options: {
    command: string;
    shell?: string;
    background?: boolean;
    stream?: boolean;
    cwd?: string;
    env?: Record<string, string>;
  }): Promise<CommandExecutionResponse> {
    return this.request<CommandExecutionResponse>('/run/command', {
      method: 'POST',
      body: JSON.stringify(options),
    });
  }

  // ============================================================================
  // File Operations
  // ============================================================================

  /**
   * List files at the specified path
   */
  async listFiles(path: string = '/'): Promise<FilesListResponse> {
    const params = new URLSearchParams({ path });
    return this.request<FilesListResponse>(`/files?${params}`);
  }

  /**
   * Create a new file with optional content
   */
  async createFile(path: string, content?: string): Promise<FileResponse> {
    return this.request<FileResponse>('/files', {
      method: 'POST',
      body: JSON.stringify({ path, content }),
    });
  }

  /**
   * Get file metadata (without content)
   */
  async getFile(path: string): Promise<FileResponse> {
    return this.request<FileResponse>(`/files/${this.encodeFilePath(path)}`);
  }

  /**
   * Encode a file path for use in URLs
   * Strips leading slash and encodes each segment separately to preserve path structure
   */
  private encodeFilePath(path: string): string {
    const pathWithoutLeadingSlash = path.startsWith('/') ? path.slice(1) : path;
    const segments = pathWithoutLeadingSlash.split('/');
    return segments.map(s => encodeURIComponent(s)).join('/');
  }

  /**
   * Read file content
   */
  async readFile(path: string): Promise<string> {
    const params = new URLSearchParams({ content: 'true' });
    const response = await this.request<FileResponse>(
      `/files/${this.encodeFilePath(path)}?${params}`
    );
    return response.data.content || '';
  }

  /**
   * Write file content (creates or updates)
   */
  async writeFile(path: string, content: string): Promise<FileResponse> {
    return this.request<FileResponse>('/files', {
      method: 'POST',
      body: JSON.stringify({ path, content }),
    });
  }

  /**
   * Delete a file or directory
   */
  async deleteFile(path: string): Promise<void> {
    return this.request<void>(`/files/${this.encodeFilePath(path)}`, {
      method: 'DELETE',
    });
  }

  /**
   * Check if a file exists (HEAD request)
   * @returns true if file exists, false otherwise
   */
  async checkFileExists(path: string): Promise<boolean> {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.config.timeout);

      const headers: Record<string, string> = {
        ...this.config.headers,
      };
      if (this._token) {
        headers['Authorization'] = `Bearer ${this._token}`;
      }

      const response = await fetch(
        `${this.config.sandboxUrl}/files/${this.encodeFilePath(path)}`,
        {
          method: 'HEAD',
          headers,
          signal: controller.signal,
        }
      );

      clearTimeout(timeoutId);
      return response.ok;
    } catch {
      return false;
    }
  }

  /**
   * Batch file operations (write or delete multiple files)
   *
   * Features:
   * - Deduplication: Last operation wins per path
   * - File locking: Prevents race conditions
   * - Deterministic ordering: Alphabetical path sorting
   * - Partial failure handling: Returns 207 Multi-Status with per-file results
   *
   * @param files - Array of file operations
   * @returns Results for each file operation
   *
   * @example
   * ```typescript
   * // Write multiple files
   * const results = await sandbox.batchWriteFiles([
   *   { path: '/app/file1.txt', operation: 'write', content: 'Hello' },
   *   { path: '/app/file2.txt', operation: 'write', content: 'World' },
   * ]);
   *
   * // Mixed operations (write and delete)
   * const results = await sandbox.batchWriteFiles([
   *   { path: '/app/new.txt', operation: 'write', content: 'New file' },
   *   { path: '/app/old.txt', operation: 'delete' },
   * ]);
   * ```
   */
  async batchWriteFiles(
    files: Array<{ path: string; operation: 'write' | 'delete'; content?: string }>
  ): Promise<BatchWriteResponse> {
    return this.request<BatchWriteResponse>('/files/batch', {
      method: 'POST',
      body: JSON.stringify({ files }),
    });
  }

  // ============================================================================
  // Filesystem Overlays
  // ============================================================================

  /**
   * Create a new filesystem overlay from a template directory
   *
   * Overlays enable instant sandbox setup by symlinking template files first,
   * then copying heavy directories (node_modules, .venv, etc.) in the background.
   *
   * @param options - Overlay creation options
   * @param options.source - Absolute path to source directory (template)
   * @param options.target - Relative path in sandbox where overlay will be mounted
   * @returns Overlay response with copy status
   *
   * @example
   * ```typescript
   * // Prefer using sandbox.filesystem.overlay.create() for camelCase response
   * const overlay = await sandbox.filesystem.overlay.create({
   *   source: '/templates/nextjs',
   *   target: 'project',
   * });
   * console.log(overlay.copyStatus); // 'pending' | 'in_progress' | 'complete' | 'failed'
   * ```
   */
  async createOverlay(options: CreateOverlayOptions): Promise<OverlayResponse> {
    return this.request<OverlayResponse>('/filesystem/overlays', {
      method: 'POST',
      body: JSON.stringify(options),
    });
  }

  /**
   * List all filesystem overlays for the current sandbox
   * @returns List of overlays with their copy status
   */
  async listOverlays(): Promise<OverlayListResponse> {
    return this.request<OverlayListResponse>('/filesystem/overlays');
  }

  /**
   * Get a specific filesystem overlay by ID
   *
   * Useful for polling the copy status of an overlay.
   *
   * @param id - Overlay ID
   * @returns Overlay details with current copy status
   */
  async getOverlay(id: string): Promise<OverlayResponse> {
    return this.request<OverlayResponse>(`/filesystem/overlays/${id}`);
  }

  /**
   * Delete a filesystem overlay
   * @param id - Overlay ID
   */
  async deleteOverlay(id: string): Promise<void> {
    return this.request<void>(`/filesystem/overlays/${id}`, {
      method: 'DELETE',
    });
  }

  // ============================================================================
  // Terminal Management
  // ============================================================================

  /**
   * Create a new persistent terminal session
   * 
   * Terminal Modes:
   * - **PTY mode** (pty: true): Interactive shell with real-time WebSocket streaming
   *   - Use for: Interactive shells, vim/nano, real-time output
   *   - Methods: write(), resize(), on('output')
   * 
   * - **Exec mode** (pty: false, default): Command tracking with HTTP polling
   *   - Use for: CI/CD, automation, command tracking, exit codes
   *   - Methods: execute(), getCommand(), listCommands(), waitForCommand()
   * 
   * @example
   * ```typescript
   * // PTY mode - Interactive shell
   * const pty = await sandbox.createTerminal({ pty: true, shell: '/bin/bash' });
   * pty.on('output', (data) => console.log(data));
   * pty.write('npm install\n');
   * 
   * // Exec mode - Command tracking
   * const exec = await sandbox.createTerminal({ pty: false });
   * const result = await exec.execute('npm test', { background: true });
   * const cmd = await sandbox.waitForCommand(exec.getId(), result.data.cmd_id);
   * console.log(cmd.data.exit_code);
   * 
   * // Backward compatible - creates PTY terminal
   * const terminal = await sandbox.createTerminal('/bin/bash');
   * ```
   * 
   * @param options - Terminal creation options
   * @param options.shell - Shell to use (e.g., '/bin/bash', '/bin/sh') - PTY mode only
   * @param options.encoding - Encoding for terminal I/O: 'raw' (default) or 'base64' (binary-safe)
   * @param options.pty - Terminal mode: true = PTY (interactive shell), false = exec (command tracking, default)
   * @returns Terminal instance with event handling
   */
  async createTerminal(
    shellOrOptions?: string | {
      shell?: string;
      encoding?: 'raw' | 'base64';
      pty?: boolean;
    },
    encoding?: 'raw' | 'base64'
  ): Promise<TerminalInstance> {
    // Backward compatibility: if first arg is string, treat as old signature
    let pty: boolean;
    let shell: string | undefined;
    let enc: 'raw' | 'base64' | undefined;

    if (typeof shellOrOptions === 'string') {
      // Old signature: createTerminal(shell?, encoding?)
      // Create PTY terminal for backward compatibility
      pty = true;
      shell = shellOrOptions;
      enc = encoding;
    } else {
      // New signature: createTerminal(options?)
      pty = shellOrOptions?.pty ?? false; // Default to exec mode
      enc = shellOrOptions?.encoding;
      shell = shellOrOptions?.shell;
    }

    // Create terminal via REST API
    const body: { shell?: string; encoding?: 'raw' | 'base64'; pty?: boolean } = {};
    if (shell) body.shell = shell;
    if (enc) body.encoding = enc;
    if (pty !== undefined) body.pty = pty;

    const response = await this.request<TerminalResponse>('/terminals', {
      method: 'POST',
      body: JSON.stringify(body),
    });

    let ws: WebSocketManager | null = null;

    // Only use WebSocket for PTY mode
    if (response.data.pty) {
      ws = await this.ensureWebSocket();

      // Wait for terminal:created event to ensure terminal is ready
      await new Promise<void>((resolve) => {
        const handler = (msg: any) => {
          if (msg.data?.id === response.data.id) {
            if (ws) ws.off('terminal:created', handler);
            resolve();
          }
        };
        if (ws) {
          ws.on('terminal:created', handler);

          // Timeout after 5 seconds
          setTimeout(() => {
            if (ws) ws.off('terminal:created', handler);
            resolve();
          }, 5000);
        } else {
          resolve();
        }
      });
    }

    const terminal = await this.hydrateTerminal(response.data, ws);
    this._terminals.set(terminal.id, terminal);
    return terminal;
  }

  /**
   * List all active terminals (fetches from API)
   */
  async listTerminals(): Promise<TerminalResponse[]> {
    const response = await this.request<{ message: string; data: { terminals: TerminalResponse[] } }>('/terminals');
    return response.data.terminals;
  }

  /**
   * Get terminal by ID
   */
  async getTerminal(id: string): Promise<TerminalInstance> {
    // Check cache first
    const cached = this._terminals.get(id);
    if (cached) {
      return cached;
    }

    // Retrieve from API
    const response = await this.request<TerminalResponse>(`/terminals/${id}`);

    // Connect WebSocket if needed for PTY
    let ws: WebSocketManager | null = null;
    if (response.data.pty) {
      ws = await this.ensureWebSocket();
      // Note: No need to wait for terminal:created as it already exists
    }

    const terminal = await this.hydrateTerminal(response.data, ws);
    this._terminals.set(id, terminal);
    return terminal;
  }

  // ============================================================================
  // Command Tracking (Exec Mode Terminals)
  // ============================================================================

  /**
   * List all commands executed in a terminal (exec mode only)
   * @param terminalId - The terminal ID
   * @returns List of all commands with their status
   * @throws {Error} If terminal is in PTY mode (command tracking not available)
   */
  async listCommands(terminalId: string): Promise<CommandsListResponse> {
    return this.request<CommandsListResponse>(`/terminals/${terminalId}/commands`);
  }

  /**
   * Get details of a specific command execution (exec mode only)
   * @param terminalId - The terminal ID
   * @param cmdId - The command ID
   * @returns Command execution details including stdout, stderr, and exit code
   * @throws {Error} If terminal is in PTY mode or command not found
   */
  async getCommand(terminalId: string, cmdId: string): Promise<CommandDetailsResponse> {
    return this.request<CommandDetailsResponse>(`/terminals/${terminalId}/commands/${cmdId}`);
  }

  /**
   * Wait for a command to complete (HTTP long-polling, exec mode only)
   * @param terminalId - The terminal ID
   * @param cmdId - The command ID
   * @param timeout - Optional timeout in seconds (0 = no timeout)
   * @returns Command execution details when completed
   * @throws {Error} If terminal is in PTY mode, command not found, or timeout occurs
   */
  async waitForCommand(
    terminalId: string,
    cmdId: string,
    timeout?: number
  ): Promise<CommandDetailsResponse> {
    const params = timeout ? new URLSearchParams({ timeout: timeout.toString() }) : '';
    const endpoint = `/terminals/${terminalId}/commands/${cmdId}/wait${params ? `?${params}` : ''}`;
    return this.request<CommandDetailsResponse>(endpoint);
  }

  /**
   * Wait for a background command to complete using long-polling
   *
   * Uses the server's long-polling endpoint with configurable timeout.
   * The tunnel supports up to 5 minutes (300 seconds) via X-Request-Timeout header.
   *
   * @param terminalId - The terminal ID
   * @param cmdId - The command ID
   * @param options - Wait options (timeoutSeconds, default 300)
   * @returns Command result with final status
   * @throws Error if command fails or times out
   * @internal
   */
  private async waitForCommandCompletion(
    terminalId: string,
    cmdId: string,
    options?: CommandWaitOptions
  ): Promise<RunCommandResult> {
    // Default to max supported by tunnel, can be overridden
    const timeoutSeconds = options?.timeoutSeconds ?? MAX_TUNNEL_TIMEOUT_SECONDS;

    const response = await this.waitForCommandWithTimeout(terminalId, cmdId, timeoutSeconds);

    return {
      stdout: response.data.stdout,
      stderr: response.data.stderr,
      exitCode: response.data.exit_code ?? 0,
      durationMs: response.data.duration_ms ?? 0,
      cmdId: response.data.cmd_id,
      terminalId: terminalId,
      status: response.data.status,
    };
  }

  /**
   * Wait for a command with extended timeout support
   * Uses X-Request-Timeout header for tunnel timeout configuration
   * @internal
   */
  private async waitForCommandWithTimeout(
    terminalId: string,
    cmdId: string,
    timeoutSeconds: number
  ): Promise<CommandDetailsResponse> {
    const params = new URLSearchParams({ timeout: timeoutSeconds.toString() });
    const endpoint = `/terminals/${terminalId}/commands/${cmdId}/wait?${params}`;

    // Use extended timeout for long-polling
    const requestTimeout = Math.min(timeoutSeconds, MAX_TUNNEL_TIMEOUT_SECONDS);

    return this.request<CommandDetailsResponse>(endpoint, {
      headers: {
        'X-Request-Timeout': requestTimeout.toString(),
      },
    });
  }

  // ============================================================================
  // File Watchers
  // ============================================================================

  /**
   * Create a new file watcher with WebSocket integration
   * @param path - Path to watch
   * @param options - Watcher options
   * @param options.includeContent - Include file content in change events
   * @param options.ignored - Patterns to ignore
   * @param options.encoding - Encoding for file content: 'raw' (default) or 'base64' (binary-safe)
   * @returns FileWatcher instance with event handling
   */
  async createWatcher(
    path: string,
    options?: {
      includeContent?: boolean;
      ignored?: string[];
      encoding?: 'raw' | 'base64';
    }
  ): Promise<FileWatcher> {
    // Ensure WebSocket is connected
    const ws = await this.ensureWebSocket();

    // Create watcher via REST API
    const response = await this.request<WatcherResponse>('/watchers', {
      method: 'POST',
      body: JSON.stringify({ path, ...options }),
    });

    // Create FileWatcher instance (no cleanup callback needed)
    const watcher = new FileWatcher(
      response.data.id,
      response.data.path,
      response.data.status,
      response.data.channel,
      response.data.includeContent,
      response.data.ignored,
      ws,
      response.data.encoding || 'raw'
    );

    // Set up watcher handlers
    watcher.setDestroyHandler(async () => {
      await this.request<void>(`/watchers/${response.data.id}`, {
        method: 'DELETE',
      });
    });

    return watcher;
  }

  /**
   * List all active file watchers (fetches from API)
   */
  async listWatchers(): Promise<WatchersListResponse> {
    return this.request<WatchersListResponse>('/watchers');
  }

  /**
   * Get file watcher by ID
   */
  async getWatcher(id: string): Promise<WatcherResponse> {
    return this.request<WatcherResponse>(`/watchers/${id}`);
  }

  // ============================================================================
  // Signal Service
  // ============================================================================

  /**
   * Start the signal service with WebSocket integration
   * @returns SignalService instance with event handling
   */
  async startSignals(): Promise<SignalService> {
    // Ensure WebSocket is connected
    const ws = await this.ensureWebSocket();

    // Start signal service via REST API
    const response = await this.request<SignalServiceResponse>('/signals/start', {
      method: 'POST',
    });

    // Create SignalService instance (no cleanup callback needed)
    const signalService = new SignalService(
      response.data.status,
      response.data.channel,
      ws
    );

    // Set up signal service handlers
    signalService.setStopHandler(async () => {
      await this.request<SignalServiceResponse>('/signals/stop', {
        method: 'POST',
      });
    });

    return signalService;
  }

  /**
   * Get the signal service status (fetches from API)
   */
  async getSignalStatus(): Promise<SignalServiceResponse> {
    return this.request<SignalServiceResponse>('/signals/status');
  }

  /**
   * Emit a port signal
   */
  async emitPortSignal(
    port: number,
    type: 'open' | 'close',
    url: string
  ): Promise<PortSignalResponse> {
    return this.request<PortSignalResponse>('/signals/port', {
      method: 'POST',
      body: JSON.stringify({ port, type, url }),
    });
  }

  /**
   * Emit a port signal (alternative endpoint using path parameters)
   */
  async emitPortSignalAlt(
    port: number,
    type: 'open' | 'close'
  ): Promise<PortSignalResponse> {
    return this.request<PortSignalResponse>(`/signals/port/${port}/${type}`, {
      method: 'POST',
    });
  }

  /**
   * Emit an error signal
   */
  async emitErrorSignal(message: string): Promise<GenericSignalResponse> {
    return this.request<GenericSignalResponse>('/signals/error', {
      method: 'POST',
      body: JSON.stringify({ message }),
    });
  }

  /**
   * Emit a server ready signal
   */
  async emitServerReadySignal(
    port: number,
    url: string
  ): Promise<PortSignalResponse> {
    return this.request<PortSignalResponse>('/signals/server-ready', {
      method: 'POST',
      body: JSON.stringify({ port, url }),
    });
  }

  // ============================================================================
  // Environment Variables
  // ============================================================================

  /**
   * Get environment variables from a .env file
   * @param file - Path to the .env file (relative to sandbox root)
   */
  async getEnv(file: string): Promise<EnvGetResponse> {
    const params = new URLSearchParams({ file });
    return this.request<EnvGetResponse>(`/env?${params}`);
  }

  /**
   * Set (merge) environment variables in a .env file
   * @param file - Path to the .env file (relative to sandbox root)
   * @param variables - Key-value pairs to set
   */
  async setEnv(
    file: string,
    variables: Record<string, string>
  ): Promise<EnvSetResponse> {
    const params = new URLSearchParams({ file });
    return this.request<EnvSetResponse>(`/env?${params}`, {
      method: 'POST',
      body: JSON.stringify({ variables }),
    });
  }

  /**
   * Delete environment variables from a .env file
   * @param file - Path to the .env file (relative to sandbox root)
   * @param keys - Keys to delete
   */
  async deleteEnv(file: string, keys: string[]): Promise<EnvDeleteResponse> {
    const params = new URLSearchParams({ file });
    return this.request<EnvDeleteResponse>(`/env?${params}`, {
      method: 'DELETE',
      body: JSON.stringify({ keys }),
    });
  }

  /**
   * Check if an environment file exists (HEAD request)
   * @param file - Path to the .env file (relative to sandbox root)
   * @returns true if file exists, false otherwise
   */
  async checkEnvFile(file: string): Promise<boolean> {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.config.timeout);

      const headers: Record<string, string> = {
        ...this.config.headers,
      };
      if (this._token) {
        headers['Authorization'] = `Bearer ${this._token}`;
      }

      const params = new URLSearchParams({ file });
      const response = await fetch(`${this.config.sandboxUrl}/env?${params}`, {
        method: 'HEAD',
        headers,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);
      return response.ok;
    } catch {
      return false;
    }
  }

  // ============================================================================
  // Server Management
  // ============================================================================

  /**
   * List all managed servers
   */
  async listServers(): Promise<ServersListResponse> {
    return this.request<ServersListResponse>('/servers');
  }

  /**
   * Start a new managed server with optional supervisor settings
   *
   * @param options - Server configuration
   * @param options.slug - Unique server identifier
   * @param options.install - Install command (optional, runs blocking before start, e.g., "npm install")
   * @param options.start - Command to start the server (e.g., "npm run dev")
   * @param options.path - Working directory (optional)
   * @param options.env_file - Path to .env file relative to path (optional)
   * @param options.environment - Inline environment variables (merged with env_file if both provided)
   * @param options.port - Requested port (preallocated before start)
   * @param options.strict_port - If true, fail instead of auto-incrementing when port is taken
   * @param options.autostart - Auto-start on daemon boot (default: true)
   * @param options.overlay - Inline overlay to create before starting
   * @param options.overlays - Additional overlays to create before starting
   * @param options.depends_on - Overlay IDs this server depends on
   * @param options.restart_policy - When to automatically restart: 'never' (default), 'on-failure', 'always'
   * @param options.max_restarts - Maximum restart attempts, 0 = unlimited (default: 0)
   * @param options.restart_delay_ms - Delay between restart attempts in milliseconds (default: 1000)
   * @param options.stop_timeout_ms - Graceful shutdown timeout in milliseconds (default: 10000)
   *
   * @example
   * ```typescript
   * // Basic server
   * await sandbox.startServer({
   *   slug: 'web',
   *   start: 'npm run dev',
   *   path: '/app',
   * });
   *
   * // With install command and supervisor settings
   * await sandbox.startServer({
   *   slug: 'api',
   *   install: 'npm install',
   *   start: 'node server.js',
   *   path: '/app',
   *   environment: { NODE_ENV: 'production', PORT: '3000' },
   *   restart_policy: 'on-failure',
   *   max_restarts: 5,
   *   restart_delay_ms: 2000,
   *   stop_timeout_ms: 5000,
   * });
   *
   * // With inline overlay dependencies
   * await sandbox.startServer({
   *   slug: 'web',
   *   start: 'npm run dev',
   *   path: '/app',
   *   overlay: {
   *     source: '/templates/nextjs',
   *     target: 'app',
   *     strategy: 'smart',
   *   },
   * });
   * ```
   */
  async startServer(options: {
    slug: string;
    install?: string;
    start: string;
    path?: string;
    env_file?: string;
    environment?: Record<string, string>;
    port?: number;
    strict_port?: boolean;
    autostart?: boolean;
    overlay?: Omit<CreateOverlayOptions, 'waitForCompletion'>;
    overlays?: Array<Omit<CreateOverlayOptions, 'waitForCompletion'>>;
    depends_on?: string[];
    restart_policy?: RestartPolicy;
    max_restarts?: number;
    restart_delay_ms?: number;
    stop_timeout_ms?: number;
  }): Promise<ServerResponse> {
    return this.request<ServerResponse>('/servers', {
      method: 'POST',
      body: JSON.stringify(options),
    });
  }

  /**
   * Get information about a specific server
   * @param slug - Server slug
   */
  async getServer(slug: string): Promise<ServerResponse> {
    return this.request<ServerResponse>(`/servers/${encodeURIComponent(slug)}`);
  }

  /**
   * Stop a managed server (non-destructive)
   * @param slug - Server slug
   */
  async stopServer(slug: string): Promise<ServerStopResponse> {
    return this.request<ServerStopResponse>(
      `/servers/${encodeURIComponent(slug)}/stop`,
      {
        method: 'POST',
      }
    );
  }

  /**
   * Delete a managed server configuration
   * @param slug - Server slug
   */
  async deleteServer(slug: string): Promise<void> {
    await this.request<void>(`/servers/${encodeURIComponent(slug)}`, {
      method: 'DELETE',
    });
  }

  /**
   * Restart a managed server
   * @param slug - Server slug
   */
  async restartServer(slug: string): Promise<ServerResponse> {
    return this.request<ServerResponse>(
      `/servers/${encodeURIComponent(slug)}/restart`,
      {
        method: 'POST',
      }
    );
  }

  /**
   * Get logs for a managed server
   * @param slug - Server slug
   * @param options - Options for log retrieval
   */
  async getServerLogs(
    slug: string,
    options?: { stream?: ServerLogStream }
  ): Promise<ServerLogsResponse> {
    const params = new URLSearchParams();
    if (options?.stream) {
      params.set('stream', options.stream);
    }
    const queryString = params.toString();
    return this.request<ServerLogsResponse>(
      `/servers/${encodeURIComponent(slug)}/logs${queryString ? `?${queryString}` : ''}`
    );
  }

  /**
   * Update server status (internal use)
   * @param slug - Server slug
   * @param status - New server status
   */
  async updateServerStatus(
    slug: string,
    status: ServerStatus
  ): Promise<ServerStatusUpdateResponse> {
    return this.request<ServerStatusUpdateResponse>(
      `/servers/${encodeURIComponent(slug)}/status`,
      {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      }
    );
  }

  // ============================================================================
  // Ready Management
  // ============================================================================

  /**
   * Get readiness status for autostarted servers and overlays
   */
  async ready(): Promise<ReadyResponse> {
    const response = await this.request<ReadyResponse>('/ready');
    return {
      ready: response.ready,
      servers: response.servers ?? [],
      overlays: response.overlays ?? [],
    };
  }

  // ============================================================================
  // Sandbox Management
  // ============================================================================

  /**
   * Create a new sandbox environment
   */
  async createSandbox(options?: CreateSandboxOptions): Promise<SandboxInfo> {
    return this.request<SandboxInfo>('/sandboxes', {
      method: 'POST',
      body: JSON.stringify(options || {}),
    });
  }

  /**
   * List all sandboxes
   */
  async listSandboxes(): Promise<SandboxesListResponse> {
    return this.request<SandboxesListResponse>('/sandboxes');
  }

  /**
   * Get sandbox details
   */
  async getSandbox(subdomain: string): Promise<SandboxInfo> {
    return this.request<SandboxInfo>(`/sandboxes/${subdomain}`);
  }

  /**
   * Delete a sandbox
   */
  async deleteSandbox(
    subdomain: string,
    deleteFiles: boolean = false
  ): Promise<void> {
    const params = new URLSearchParams({ delete_files: String(deleteFiles) });
    return this.request<void>(`/sandboxes/${subdomain}?${params}`, {
      method: 'DELETE',
    });
  }

  // ============================================================================
  // WebSocket Connection (Internal)
  // ============================================================================

  /**
   * Get WebSocket URL for real-time communication
   * @private
   */
  private getWebSocketUrl(): string {
    const wsProtocol = this.config.sandboxUrl.startsWith('https') ? 'wss' : 'ws';
    const url = this.config.sandboxUrl.replace(/^https?:/, `${wsProtocol}:`);

    // Build query parameters
    const params = new URLSearchParams();
    if (this._token) {
      params.set('token', this._token);
    }
    // Always send protocol parameter
    params.set('protocol', this.config.protocol || 'binary');

    const queryString = params.toString();
    return `${url}/ws${queryString ? `?${queryString}` : ''}`;
  }

  // ============================================================================
  // Sandbox Interface Implementation
  // ============================================================================

  /**
   * Execute code in the sandbox (convenience method)
   *
   * Delegates to sandbox.run.code() - prefer using that directly for new code.
   *
   * @param code - The code to execute
   * @param language - Programming language (auto-detected if not specified)
   * @returns Code execution result
   */
  async runCode(code: string, language?: 'node' | 'python'): Promise<{
    output: string;
    exitCode: number;
    language: string;
  }> {
    return this.run.code(code, language ? { language } : undefined);
  }

  /**
   * Execute shell command in the sandbox
   *
   * Sends clean command string to server - no preprocessing or shell wrapping.
   * The server handles shell invocation, working directory, and backgrounding.
   *
   * @param command - The command to execute (raw string, e.g., "npm install")
   * @param options - Execution options
   * @param options.background - Run in background (server uses goroutines)
   * @param options.cwd - Working directory (server uses cmd.Dir)
   * @param options.env - Environment variables (server uses cmd.Env)
   * @param options.onStdout - Callback for streaming stdout data
   * @param options.onStderr - Callback for streaming stderr data
   * @returns Command execution result
   * 
   * @example
   * ```typescript
   * // Simple command
   * await sandbox.runCommand('ls -la')
   * 
   * // With working directory
   * await sandbox.runCommand('npm install', { cwd: '/app' })
   * 
   * // Background with env vars
   * await sandbox.runCommand('node server.js', { 
   *   background: true, 
   *   env: { PORT: '3000' } 
   * })
   * 
   * // With streaming output
   * await sandbox.runCommand('npm install', {
   *   onStdout: (data) => console.log(data),
   *   onStderr: (data) => console.error(data),
   * })
   * ```
   */
  async runCommand(
    command: string,
    options?: {
      background?: boolean;
      cwd?: string;
      env?: Record<string, string>;
      onStdout?: (data: string) => void;
      onStderr?: (data: string) => void;
    }
  ): Promise<{
    stdout: string;
    stderr: string;
    exitCode: number;
    durationMs: number;
  }> {
    const hasStreamingCallbacks = options?.onStdout || options?.onStderr;
    
    if (!hasStreamingCallbacks) {
      // Non-streaming mode: use existing behavior
      return this.run.command(command, options);
    }

    // Two-phase streaming flow:
    // 1. POST /run/command with stream: true -> returns cmd_id, channel, status: "pending"
    // 2. Subscribe to channel via WebSocket
    // 3. Send command:start to trigger execution
    // This ensures we're subscribed before the command runs (no race condition).
    
    // Get or create WebSocket connection first
    const ws = await this.ensureWebSocket();

    // Phase 1: Create pending command
    const result = await this.runCommandRequest({
      command,
      stream: true,
      cwd: options?.cwd,
      env: options?.env,
    });

    const { cmd_id, channel } = result.data;

    if (!cmd_id || !channel) {
      throw new Error('Server did not return streaming channel info');
    }

    // Phase 2: Subscribe to channel
    ws.subscribe(channel);

    // Collect stdout/stderr for final result
    let stdout = '';
    let stderr = '';
    let exitCode = 0;
    let resolvePromise: ((value: { stdout: string; stderr: string; exitCode: number; durationMs: number }) => void) | null = null;

    const cleanup = () => {
      ws.off('command:stdout', handleStdout);
      ws.off('command:stderr', handleStderr);
      ws.off('command:exit', handleExit);
      ws.unsubscribe(channel);
    };

    const handleStdout = (msg: { channel: string; data: { cmd_id: string; output: string } }) => {
      if (msg.channel === channel && msg.data.cmd_id === cmd_id) {
        stdout += msg.data.output;
        options?.onStdout?.(msg.data.output);
      }
    };

    const handleStderr = (msg: { channel: string; data: { cmd_id: string; output: string } }) => {
      if (msg.channel === channel && msg.data.cmd_id === cmd_id) {
        stderr += msg.data.output;
        options?.onStderr?.(msg.data.output);
      }
    };

    const handleExit = (msg: { channel: string; data: { cmd_id: string; exit_code: number } }) => {
      if (msg.channel === channel && msg.data.cmd_id === cmd_id) {
        exitCode = msg.data.exit_code;
        cleanup();
        // Resolve promise if we're waiting (non-background mode)
        if (resolvePromise) {
          resolvePromise({ stdout, stderr, exitCode, durationMs: 0 });
        }
      }
    };

    ws.on('command:stdout', handleStdout);
    ws.on('command:stderr', handleStderr);
    ws.on('command:exit', handleExit);

    // Phase 3: Send command:start to trigger execution
    ws.startCommand(cmd_id);

    // Background mode: return immediately, callbacks continue firing in background
    if (options?.background) {
      return {
        stdout: '',
        stderr: '',
        exitCode: 0,
        durationMs: 0,
      };
    }

    // Non-background streaming: wait for command to complete
    return new Promise((resolve) => {
      resolvePromise = resolve;
    });
  }

  /**
   * Get server information
   * Returns details about the server including auth status, main subdomain, sandbox count, and version
   */
  async getServerInfo(): Promise<InfoResponse> {
    return this.request<InfoResponse>('/info');
  }

  /**
   * Get sandbox information
   */
  async getInfo(): Promise<{
    id: string;
    provider: string;
    runtime: 'node' | 'python';
    status: 'running' | 'stopped' | 'error';
    createdAt: Date;
    timeout: number;
    metadata?: Record<string, any>;
  }> {
    return {
      id: this.sandboxId || '',
      provider: this.provider || '',
      runtime: 'node' as const,
      status: 'running' as const,
      createdAt: new Date(),
      timeout: this.config.timeout,
      metadata: this.config.metadata
    };
  }

  /**
   * Get URL for accessing sandbox on a specific port (Sandbox interface method)
   */
  async getUrl(options: { port: number; protocol?: string }): Promise<string> {
    const protocol = options.protocol || 'https';
    // Extract components from sandboxUrl
    const url = new URL(this.config.sandboxUrl);
    const parts = url.hostname.split('.');
    const subdomain = parts[0]; // Extract "sandbox-123" or "abc"
    const baseDomain = parts.slice(1).join('.'); // Extract "sandbox.computesdk.com"

    // ComputeSDK has two domains:
    // - sandbox.computesdk.com: Management/control plane
    // - preview.computesdk.com: Preview URLs for services
    // When getting a URL for a port, we need the preview domain
    const previewDomain = baseDomain.replace('sandbox.computesdk.com', 'preview.computesdk.com');

    // ComputeSDK URL pattern: ${subdomain}-${port}.${previewDomain}
    // Examples:
    //   - https://sandbox-123.sandbox.computesdk.com → https://sandbox-123-3000.preview.computesdk.com
    return `${protocol}://${subdomain}-${options.port}.${previewDomain}`;
  }

  /**
   * Get provider instance
   * Note: Not available when using Sandbox directly - only available through gateway provider
   */
  getProvider(): never {
    throw new Error(
      'getProvider() is not available on Sandbox. ' +
      'This method is only available when using provider sandboxes through the gateway.'
    );
  }

  /**
   * Get native provider instance
   * Returns the Sandbox itself since this IS the sandbox implementation
   */
  getInstance(): this {
    return this;
  }

  /**
   * Destroy the sandbox (Sandbox interface method)
   * 
   * If a destroyHandler was provided (e.g., from gateway), calls it to destroy
   * the sandbox on the backend. Otherwise, only disconnects the WebSocket.
   */
  async destroy(): Promise<void> {
    // Disconnect WebSocket first
    await this.disconnect();
    
    // Call destroy handler if provided (e.g., gateway DELETE endpoint)
    if (this.config.destroyHandler) {
      await this.config.destroyHandler();
    }
  }

  /**
   * Disconnect WebSocket
   *
   * Note: This only disconnects the WebSocket. Terminals, watchers, and signals
   * will continue running on the server until explicitly destroyed via their
   * respective destroy() methods or the DELETE endpoints.
   */
  async disconnect(): Promise<void> {
    // Disconnect WebSocket
    if (this._ws) {
      this._ws.disconnect();
      this._ws = null;
    }
    // Clear terminal cache as instances hold reference to closed WebSocket
    this._terminals.clear();
  }
}

/**
 * Create a new Sandbox instance
 *
 * @example
 * ```typescript
 * import { createSandbox } from '@computesdk/client'
 *
 * // Create sandbox with access token or session token
 * const sandbox = createSandbox({
 *   sandboxUrl: 'https://sandbox-123.sandbox.computesdk.com',
 *   token: accessToken,
 * });
 *
 * // Execute commands
 * const result = await sandbox.execute({ command: 'ls -la' });
 * ```
 */
export function createSandbox(config: SandboxConfig): Sandbox {
  return new Sandbox(config);
}

// ============================================================================
// Backwards Compatibility Aliases
// ============================================================================

/** @deprecated Use SandboxConfig instead */
export type ComputeClientConfig = SandboxConfig;

/** @deprecated Use Sandbox instead */
export { Sandbox as ComputeClient };

/** @deprecated Use createSandbox instead */
export { createSandbox as createClient };
