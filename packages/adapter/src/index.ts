/**
 * ComputeSDK Adapter - Universal Adapter Implementation
 *
 * This package provides an adapter for interacting with ComputeSDK sandboxes
 * through API endpoints at ${sandboxId}.preview.computesdk.com
 *
 * Works in browser, Node.js, and edge runtimes.
 * Browser: Uses native WebSocket and fetch
 * Node.js: Pass WebSocket implementation (e.g., 'ws' library)
 */

import { WebSocketManager } from './websocket';
import { Terminal } from './terminal';
import { FileWatcher } from './file-watcher';
import { SignalService } from './signal-service';

// Re-export high-level classes and types
export { Terminal } from './terminal';
export { FileWatcher, type FileChangeEvent } from './file-watcher';
export { SignalService, type PortSignalEvent, type ErrorSignalEvent, type SignalEvent } from './signal-service';

// Re-export WebContainer polyfill
export {
  WebContainer,
  WebContainerProcess,
  FileSystemAPI,
  type BootOptions,
  type SpawnOptions,
  type FileSystemTree,
  type FileNode,
  type DirectoryNode,
  type SymlinkNode,
  type DirEnt,
  type BufferEncoding
} from './webcontainer-polyfill';

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * WebSocket constructor type
 */
export type WebSocketConstructor = new (url: string) => WebSocket;

/**
 * Configuration options for the ComputeSDK adapter
 */
export interface ComputeAdapterConfig {
  /** API endpoint URL (e.g., https://sandbox-123.preview.computesdk.com) */
  sandboxUrl: string;
  /** Optional JWT token for authentication */
  token?: string;
  /** Optional headers to include with all requests */
  headers?: Record<string, string>;
  /** Request timeout in milliseconds (default: 30000) */
  timeout?: number;
  /** WebSocket implementation (optional, uses global WebSocket if not provided) */
  WebSocket?: WebSocketConstructor;
}

/**
 * Health check response
 */
export interface HealthResponse {
  status: string;
  timestamp: string;
}

/**
 * Authentication token response
 */
export interface TokenResponse {
  message: string;
  data: {
    token: string;
    expires_in: number;
    usage: {
      recommended: string;
      alternative: string;
      security_note: string;
    };
  };
}

/**
 * Token status response
 */
export interface TokenStatusResponse {
  message: string;
  data: {
    token_issued: boolean;
    status: 'available' | 'claimed';
    available: boolean;
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
    usage: {
      header: string;
      query: string;
    };
    endpoints: {
      generate_token: string;
      check_status: string;
      info: string;
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
    status: 'running' | 'stopped';
    channel: string;
    ws_url: string;
  };
}

/**
 * Command execution response
 */
export interface CommandExecutionResponse {
  message: string;
  data: {
    terminal_id?: string;
    command: string;
    output: string;
    stdout: string;
    stderr: string;
    exit_code: number;
    duration_ms: number;
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

// ============================================================================
// ComputeSDK Client
// ============================================================================

/**
 * ComputeSDK Client for browser environments
 *
 * @example
 * ```typescript
 * import { ComputeClient } from '@computesdk/client'
 *
 * // Create client and authenticate
 * const client = new ComputeClient({
 *   sandboxUrl: 'https://sandbox-123.preview.computesdk.com'
 * });
 * await client.generateToken();
 *
 * // Execute a one-off command
 * const result = await client.execute({ command: 'ls -la' });
 * console.log(result.data.stdout);
 *
 * // Work with files
 * const files = await client.listFiles('/home/project');
 * await client.writeFile('/home/project/test.txt', 'Hello, World!');
 * const content = await client.readFile('/home/project/test.txt');
 *
 * // Create a terminal with real-time output
 * const terminal = await client.createTerminal();
 * terminal.on('output', (data) => console.log(data));
 * terminal.write('ls -la\n');
 * await terminal.execute('echo "Hello"');
 * await terminal.destroy();
 *
 * // Watch for file changes
 * const watcher = await client.createWatcher('/home/project', {
 *   ignored: ['node_modules', '.git']
 * });
 * watcher.on('change', (event) => {
 *   console.log(`${event.event}: ${event.path}`);
 * });
 * await watcher.destroy();
 *
 * // Monitor system signals
 * const signals = await client.startSignals();
 * signals.on('port', (event) => {
 *   console.log(`Port ${event.port} opened: ${event.url}`);
 * });
 * await signals.stop();
 *
 * // Clean up
 * await client.disconnect();
 * ```
 */
export class ComputeAdapter {
  private config: Required<Omit<ComputeAdapterConfig, 'WebSocket'>>;
  private _token: string | null = null;
  private _ws: WebSocketManager | null = null;
  private WebSocketImpl: WebSocketConstructor;

  constructor(config: ComputeAdapterConfig) {
    this.config = {
      sandboxUrl: config.sandboxUrl.replace(/\/$/, ''), // Remove trailing slash
      token: config.token || '',
      headers: config.headers || {},
      timeout: config.timeout || 30000,
    };

    // Use provided WebSocket or fall back to global
    this.WebSocketImpl = config.WebSocket || (globalThis.WebSocket as any);

    if (!this.WebSocketImpl) {
      throw new Error(
        'WebSocket is not available. In Node.js, pass WebSocket implementation:\n' +
        'import WebSocket from "ws";\n' +
        'new ComputeAdapter({ sandboxUrl: "...", WebSocket })'
      );
    }

    if (config.token) {
      this._token = config.token;
    }
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
        debug: true,
      });
      await this._ws.connect();
    }
    return this._ws;
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

      const data = await response.json();

      if (!response.ok) {
        const error = (data as ErrorResponse).error || response.statusText;
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
   * Generate authentication token (first-come-first-served)
   * The first client to call this endpoint will receive a token.
   * Subsequent calls will fail with a 409 Conflict error.
   */
  async generateToken(): Promise<TokenResponse> {
    const response = await this.request<TokenResponse>('/auth/token', {
      method: 'POST',
    });

    // Store token for future requests
    this._token = response.data.token;

    return response;
  }

  /**
   * Check token status
   */
  async getTokenStatus(): Promise<TokenStatusResponse> {
    return this.request<TokenStatusResponse>('/auth/status');
  }

  /**
   * Get authentication information
   */
  async getAuthInfo(): Promise<AuthInfoResponse> {
    return this.request<AuthInfoResponse>('/auth/info');
  }

  /**
   * Set token manually
   */
  setToken(token: string): void {
    this._token = token;
  }

  /**
   * Get current token
   */
  getToken(): string | null {
    return this._token;
  }

  // ============================================================================
  // Command Execution
  // ============================================================================

  /**
   * Execute a one-off command without creating a persistent terminal
   */
  async execute(options: {
    command: string;
    shell?: string;
  }): Promise<CommandExecutionResponse> {
    return this.request<CommandExecutionResponse>('/execute', {
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
    return this.request<FileResponse>(`/files/${encodeURIComponent(path)}`);
  }

  /**
   * Read file content
   */
  async readFile(path: string): Promise<string> {
    const params = new URLSearchParams({ content: 'true' });
    // Encode each path segment separately to handle special characters in filenames
    // while preserving forward slashes as path separators
    const pathWithoutLeadingSlash = path.startsWith('/') ? path.slice(1) : path;
    const segments = pathWithoutLeadingSlash.split('/');
    const encodedPath = segments.map(s => encodeURIComponent(s)).join('/');
    const response = await this.request<FileResponse>(
      `/files/${encodedPath}?${params}`
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
    return this.request<void>(`/files/${encodeURIComponent(path)}`, {
      method: 'DELETE',
    });
  }

  // ============================================================================
  // Terminal Management
  // ============================================================================

  /**
   * Create a new persistent terminal session with WebSocket integration
   * @returns Terminal instance with event handling
   */
  async createTerminal(shell?: string): Promise<Terminal> {
    // Ensure WebSocket is connected
    const ws = await this.ensureWebSocket();

    // Create terminal via REST API
    const response = await this.request<TerminalResponse>('/terminals', {
      method: 'POST',
      body: JSON.stringify(shell ? { shell } : {}),
    });

    // Wait for terminal:created event to ensure terminal is ready
    await new Promise<void>((resolve) => {
      const handler = (msg: any) => {
        if (msg.data?.id === response.data.id) {
          ws.off('terminal:created', handler);
          resolve();
        }
      };
      ws.on('terminal:created', handler);

      // Timeout after 5 seconds
      setTimeout(() => {
        ws.off('terminal:created', handler);
        resolve();
      }, 5000);
    });

    // Create Terminal instance (no cleanup callback needed)
    const terminal = new Terminal(
      response.data.id,
      response.data.status,
      response.data.channel,
      ws
    );

    // Set up terminal handlers
    terminal.setExecuteHandler(async (command: string) => {
      return this.request<CommandExecutionResponse>(`/terminals/${response.data.id}/execute`, {
        method: 'POST',
        body: JSON.stringify({ command }),
      });
    });

    terminal.setDestroyHandler(async () => {
      await this.request<void>(`/terminals/${response.data.id}`, {
        method: 'DELETE',
      });
    });

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
  async getTerminal(id: string): Promise<TerminalResponse> {
    return this.request<TerminalResponse>(`/terminals/${id}`);
  }

  // ============================================================================
  // File Watchers
  // ============================================================================

  /**
   * Create a new file watcher with WebSocket integration
   * @returns FileWatcher instance with event handling
   */
  async createWatcher(
    path: string,
    options?: {
      includeContent?: boolean;
      ignored?: string[];
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
      ws
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
  // Sandbox Management
  // ============================================================================

  /**
   * Create a new sandbox environment
   */
  async createSandbox(): Promise<SandboxInfo> {
    return this.request<SandboxInfo>('/sandboxes', {
      method: 'POST',
      body: JSON.stringify({}),
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
    const token = this._token ? `?token=${this._token}` : '';
    return `${url}/ws${token}`;
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
  }
}

/**
 * Create a new ComputeSDK client instance
 *
 * @example
 * ```typescript
 * import { createClient } from '@computesdk/client'
 *
 * const client = createClient({
 *   sandboxUrl: 'https://sandbox-123.preview.computesdk.com'
 * });
 *
 * // Generate token (first client wins)
 * await client.generateToken();
 *
 * // Execute commands
 * const result = await client.execute({ command: 'ls -la' });
 * ```
 */
export function createAdapter(config: ComputeAdapterConfig): ComputeAdapter {
  return new ComputeAdapter(config);
}

// Backwards compatibility alias
export const createClient = createAdapter;
export type ComputeClient = ComputeAdapter;
export type ComputeClientConfig = ComputeAdapterConfig;
