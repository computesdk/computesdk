/**
 * ComputeSDK Client - Universal Client Implementation
 *
 * This package provides a Client for interacting with ComputeSDK sandboxes
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
export { encodeBinaryMessage, decodeBinaryMessage, isBinaryData, blobToArrayBuffer, MessageType } from './protocol';

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * WebSocket constructor type
 */
export type WebSocketConstructor = new (url: string) => WebSocket;

/**
 * Configuration options for the ComputeSDK client
 */
export interface ComputeClientConfig {
  /** API endpoint URL (e.g., https://sandbox-123.preview.computesdk.com). Optional in browser - can be auto-detected from URL query param or localStorage */
  sandboxUrl?: string;
  /** Sandbox ID (required for Sandbox interface operations) */
  sandboxId?: string;
  /** Provider name (e.g., 'e2b', 'vercel') (required for Sandbox interface operations) */
  provider?: string;
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
    status: 'running' | 'stopped';
    channel: string;
    ws_url: string;
    encoding?: 'raw' | 'base64';
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
 * ComputeSDK Client for browser and Node.js environments
 *
 * @example
 * ```typescript
 * import { ComputeClient } from '@computesdk/client'
 *
 * // Pattern 1: Admin operations (requires access token)
 * const adminClient = new ComputeClient({
 *   sandboxUrl: 'https://sandbox-123.preview.computesdk.com',
 *   token: accessToken, // From edge service
 * });
 *
 * // Create session token for delegated operations
 * const sessionToken = await adminClient.createSessionToken({
 *   description: 'My Application',
 *   expiresIn: 604800, // 7 days
 * });
 *
 * // Pattern 2: Delegated operations (binary protocol by default)
 * const client = new ComputeClient({
 *   sandboxUrl: 'https://sandbox-123.preview.computesdk.com',
 *   token: sessionToken.data.token,
 *   // protocol: 'binary' is the default (50-90% size reduction)
 * });
 *
 * // Pattern 3: JSON protocol for debugging (if needed)
 * const debugClient = new ComputeClient({
 *   sandboxUrl: 'https://sandbox-123.preview.computesdk.com',
 *   token: sessionToken.data.token,
 *   protocol: 'json', // Use JSON for browser DevTools inspection
 * });
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
export class ComputeClient {
  readonly sandboxId: string | undefined;
  readonly provider: string | undefined;
  readonly filesystem: {
    readFile: (path: string) => Promise<string>;
    writeFile: (path: string, content: string) => Promise<void>;
    mkdir: (path: string) => Promise<void>;
    readdir: (path: string) => Promise<Array<{
      name: string;
      path: string;
      isDirectory: boolean;
      size: number;
      lastModified: Date;
    }>>;
    exists: (path: string) => Promise<boolean>;
    remove: (path: string) => Promise<void>;
  };

  private config: Required<Omit<ComputeClientConfig, 'WebSocket'>>;
  private _token: string | null = null;
  private _ws: WebSocketManager | null = null;
  private WebSocketImpl: WebSocketConstructor;

  constructor(config: ComputeClientConfig = {}) {
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
    };

    // Use provided WebSocket or fall back to global
    this.WebSocketImpl = config.WebSocket || (globalThis.WebSocket as any);

    if (!this.WebSocketImpl) {
      throw new Error(
        'WebSocket is not available. In Node.js, pass WebSocket implementation:\n' +
        'import WebSocket from "ws";\n' +
        'new ComputeClient({ sandboxUrl: "...", WebSocket })'
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

    // Initialize filesystem interface
    this.filesystem = {
      readFile: async (path: string) => this.readFile(path),
      writeFile: async (path: string, content: string) => {
        await this.writeFile(path, content);
      },
      mkdir: async (path: string) => {
        await this.execute({ command: `mkdir -p ${path}` });
      },
      readdir: async (path: string) => {
        const response = await this.listFiles(path);
        return response.data.files.map(f => ({
          name: f.name,
          path: f.path,
          isDirectory: f.is_dir,
          size: f.size,
          lastModified: new Date(f.modified_at)
        }));
      },
      exists: async (path: string) => {
        const result = await this.execute({ command: `test -e ${path}` });
        return result.data.exit_code === 0;
      },
      remove: async (path: string) => {
        await this.deleteFile(path);
      }
    };
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
   * @param shell - Shell to use (e.g., '/bin/bash', '/bin/sh')
   * @param encoding - Encoding for terminal I/O: 'raw' (default) or 'base64' (binary-safe)
   * @returns Terminal instance with event handling
   */
  async createTerminal(shell?: string, encoding?: 'raw' | 'base64'): Promise<Terminal> {
    // Ensure WebSocket is connected
    const ws = await this.ensureWebSocket();

    // Create terminal via REST API
    const body: { shell?: string; encoding?: 'raw' | 'base64' } = {};
    if (shell) body.shell = shell;
    if (encoding) body.encoding = encoding;

    const response = await this.request<TerminalResponse>('/terminals', {
      method: 'POST',
      body: JSON.stringify(body),
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
      ws,
      response.data.encoding || 'raw'
    );

    // Set up terminal handlers
    terminal.setExecuteHandler(async (command: string, async?: boolean) => {
      return this.request<CommandExecutionResponse>(`/terminals/${response.data.id}/execute`, {
        method: 'POST',
        body: JSON.stringify({ command, async }),
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
   * Execute code in the sandbox (Sandbox interface method)
   */
  async runCode(code: string, runtime?: 'node' | 'python'): Promise<{
    stdout: string;
    stderr: string;
    exitCode: number;
    executionTime: number;
    sandboxId: string;
    provider: string;
  }> {
    const command = runtime === 'python' ? 'python3' : 'node';
    const result = await this.execute({
      command: `${command} -c ${JSON.stringify(code)}`
    });

    return {
      stdout: result.data.stdout,
      stderr: result.data.stderr,
      exitCode: result.data.exit_code,
      executionTime: result.data.duration_ms,
      sandboxId: this.sandboxId || '',
      provider: this.provider || ''
    };
  }

  /**
   * Execute shell commands (Sandbox interface method)
   */
  async runCommand(command: string, args?: string[], _options?: { background?: boolean }): Promise<{
    stdout: string;
    stderr: string;
    exitCode: number;
    executionTime: number;
    sandboxId: string;
    provider: string;
  }> {
    const fullCommand = args && args.length > 0
      ? `${command} ${args.join(' ')}`
      : command;

    const result = await this.execute({ command: fullCommand });

    return {
      stdout: result.data.stdout,
      stderr: result.data.stderr,
      exitCode: result.data.exit_code,
      executionTime: result.data.duration_ms,
      sandboxId: this.sandboxId || '',
      provider: this.provider || ''
    };
  }

  /**
   * Get server information
   * Returns details about the server including auth status, main subdomain, sandbox count, and version
   */
  async getServerInfo(): Promise<InfoResponse> {
    return this.request<InfoResponse>('/info');
  }

  /**
   * Get sandbox information (Sandbox interface method)
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
    // Return basic info - the client doesn't track all these details
    return {
      id: this.sandboxId || '',
      provider: this.provider || '',
      runtime: 'node', // Default runtime
      status: 'running',
      createdAt: new Date(),
      timeout: this.config.timeout
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
    const baseDomain = parts.slice(1).join('.'); // Extract "sandbox.computesdk.com" or "preview.computesdk.com"

    // ComputeSDK has two domains:
    // - sandbox.computesdk.com: Management/control plane
    // - preview.computesdk.com: Preview URLs for services
    // When getting a URL for a port, we need the preview domain
    const previewDomain = baseDomain.replace('sandbox.computesdk.com', 'preview.computesdk.com');

    // ComputeSDK URL pattern: ${subdomain}-${port}.${previewDomain}
    // Examples:
    //   - https://abc.sandbox.computesdk.com → https://abc-3000.preview.computesdk.com
    //   - https://sandbox-123.preview.computesdk.com → https://sandbox-123-3000.preview.computesdk.com
    return `${protocol}://${subdomain}-${options.port}.${previewDomain}`;
  }

  /**
   * Get provider instance (Sandbox interface method)
   * Note: Not available when using ComputeClient directly
   */
  getProvider(): never {
    throw new Error(
      'getProvider() is not available when using ComputeClient. ' +
      'The client abstracts away the underlying provider.'
    );
  }

  /**
   * Get native provider instance (Sandbox interface method)
   * Note: Not available when using ComputeClient directly
   */
  getInstance(): never {
    throw new Error(
      'getInstance() is not available when using ComputeClient. ' +
      'The client provides a unified interface across all providers.'
    );
  }

  /**
   * Kill the sandbox (Sandbox interface method)
   */
  async kill(): Promise<void> {
    await this.destroy();
  }

  /**
   * Destroy the sandbox (Sandbox interface method)
   */
  async destroy(): Promise<void> {
    await this.disconnect();
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
 * // Create client with access token or session token
 * const client = createClient({
 *   sandboxUrl: 'https://sandbox-123.preview.computesdk.com',
 *   token: accessToken, // Access token from edge service or session token from createSessionToken()
 * });
 *
 * // Execute commands
 * const result = await client.execute({ command: 'ls -la' });
 * ```
 */
export function createClient(config: ComputeClientConfig): ComputeClient {
  return new ComputeClient(config);
}
