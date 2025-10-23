/**
 * ComputeSDK Client - Browser Client Implementation
 *
 * This package provides a browser-friendly client for interacting with ComputeSDK
 * sandboxes through API endpoints at ${sandboxId}.preview.computesdk.co
 */

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * Configuration options for the ComputeSDK client
 */
export interface ComputeClientConfig {
  /** API endpoint URL (e.g., https://sandbox-123.preview.computesdk.co) */
  apiUrl: string;
  /** Optional JWT token for authentication */
  token?: string;
  /** Optional headers to include with all requests */
  headers?: Record<string, string>;
  /** Request timeout in milliseconds (default: 30000) */
  timeout?: number;
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
 * // Create client (will auto-generate token on first request)
 * const client = new ComputeClient({
 *   apiUrl: 'https://sandbox-123.preview.computesdk.co'
 * });
 *
 * // Or provide token explicitly
 * const clientWithToken = new ComputeClient({
 *   apiUrl: 'https://sandbox-123.preview.computesdk.co',
 *   token: 'your-jwt-token'
 * });
 *
 * // Execute a command
 * const result = await client.execute({ command: 'ls -la' });
 * console.log(result.data.stdout);
 *
 * // Work with files
 * const files = await client.listFiles('/home/project');
 * await client.writeFile('/home/project/test.txt', 'Hello, World!');
 * const content = await client.readFile('/home/project/test.txt');
 *
 * // Create a terminal
 * const terminal = await client.createTerminal();
 * const execResult = await client.executeInTerminal(terminal.data.id, 'echo "Hello"');
 *
 * // Watch files
 * const watcher = await client.createWatcher('/home/project', {
 *   ignored: ['node_modules', '.git']
 * });
 * ```
 */
export class ComputeClient {
  private config: Required<ComputeClientConfig>;
  private _token: string | null = null;

  constructor(config: ComputeClientConfig) {
    this.config = {
      apiUrl: config.apiUrl.replace(/\/$/, ''), // Remove trailing slash
      token: config.token || '',
      headers: config.headers || {},
      timeout: config.timeout || 30000,
    };

    if (config.token) {
      this._token = config.token;
    }
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
        'Content-Type': 'application/json',
        ...this.config.headers,
      };

      // Add authentication if token is available
      if (this._token) {
        headers['Authorization'] = `Bearer ${this._token}`;
      }

      const response = await fetch(`${this.config.apiUrl}${endpoint}`, {
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
    const response = await this.request<FileResponse>(
      `/files/${encodeURIComponent(path)}?${params}`
    );
    return response.data.content || '';
  }

  /**
   * Write file content (creates or updates)
   */
  async writeFile(path: string, content: string): Promise<FileResponse> {
    return this.request<FileResponse>(`/files/${encodeURIComponent(path)}`, {
      method: 'PUT',
      body: JSON.stringify({ content }),
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
   * Create a new persistent terminal session
   */
  async createTerminal(shell?: string): Promise<TerminalResponse> {
    return this.request<TerminalResponse>('/terminals', {
      method: 'POST',
      body: JSON.stringify(shell ? { shell } : {}),
    });
  }

  /**
   * Get terminal details
   */
  async getTerminal(id: string): Promise<TerminalResponse> {
    return this.request<TerminalResponse>(`/terminals/${id}`);
  }

  /**
   * Delete a terminal session
   */
  async deleteTerminal(id: string): Promise<void> {
    return this.request<void>(`/terminals/${id}`, {
      method: 'DELETE',
    });
  }

  /**
   * Execute a command in an existing terminal session
   */
  async executeInTerminal(
    id: string,
    command: string
  ): Promise<CommandExecutionResponse> {
    return this.request<CommandExecutionResponse>(`/terminals/${id}/execute`, {
      method: 'POST',
      body: JSON.stringify({ command }),
    });
  }

  // ============================================================================
  // File Watchers
  // ============================================================================

  /**
   * List all active file watchers
   */
  async listWatchers(): Promise<WatchersListResponse> {
    return this.request<WatchersListResponse>('/watchers');
  }

  /**
   * Create a new file watcher
   */
  async createWatcher(
    path: string,
    options?: {
      includeContent?: boolean;
      ignored?: string[];
    }
  ): Promise<WatcherResponse> {
    return this.request<WatcherResponse>('/watchers', {
      method: 'POST',
      body: JSON.stringify({ path, ...options }),
    });
  }

  /**
   * Get file watcher details
   */
  async getWatcher(id: string): Promise<WatcherResponse> {
    return this.request<WatcherResponse>(`/watchers/${id}`);
  }

  /**
   * Delete a file watcher
   */
  async deleteWatcher(id: string): Promise<void> {
    return this.request<void>(`/watchers/${id}`, {
      method: 'DELETE',
    });
  }

  // ============================================================================
  // Signal Service
  // ============================================================================

  /**
   * Start the signal service for monitoring system events
   */
  async startSignals(): Promise<SignalServiceResponse> {
    return this.request<SignalServiceResponse>('/signals/start', {
      method: 'POST',
    });
  }

  /**
   * Stop the signal service
   */
  async stopSignals(): Promise<SignalServiceResponse> {
    return this.request<SignalServiceResponse>('/signals/stop', {
      method: 'POST',
    });
  }

  /**
   * Get signal service status
   */
  async getSignalsStatus(): Promise<SignalServiceResponse> {
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
  // WebSocket Connection
  // ============================================================================

  /**
   * Get WebSocket URL for real-time communication
   * Use this URL to establish a WebSocket connection for terminals, watchers, and signals
   */
  getWebSocketUrl(): string {
    const wsProtocol = this.config.apiUrl.startsWith('https') ? 'wss' : 'ws';
    const url = this.config.apiUrl.replace(/^https?:/, wsProtocol);
    const token = this._token ? `?token=${this._token}` : '';
    return `${url}/ws${token}`;
  }

  /**
   * Create a WebSocket connection
   * @returns WebSocket instance ready for communication
   */
  createWebSocket(): WebSocket {
    return new WebSocket(this.getWebSocketUrl());
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
 *   apiUrl: 'https://sandbox-123.preview.computesdk.co'
 * });
 *
 * // Generate token (first client wins)
 * await client.generateToken();
 *
 * // Execute commands
 * const result = await client.execute({ command: 'ls -la' });
 * ```
 */
export function createClient(config: ComputeClientConfig): ComputeClient {
  return new ComputeClient(config);
}
