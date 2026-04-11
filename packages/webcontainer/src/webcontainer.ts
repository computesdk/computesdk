/**
 * WebContainer adapter for computesdk
 * 
 * Provides a WebContainer-compatible API that works with remote computesdk sandboxes.
 * This allows existing WebContainer code to run on remote sandboxes with minimal changes.
 * 
 * Key differences from local WebContainers:
 * - `boot()` is replaced by `connect()` for remote sandboxes
 * - The boot happens on a remote machine, so `connect()` just establishes the connection
 * - All operations are performed via HTTP/WebSocket to the remote sandbox
 * 
 * @example
 * ```typescript
 * import { WebContainer } from '@computesdk/webcontainer';
 * 
 * // Connect to a remote sandbox (instead of boot)
 * const container = await WebContainer.connect({
 *   sandboxUrl: 'https://sandbox-123.sandbox.computesdk.com',
 *   sandboxId: 'sandbox-123',
 *   provider: 'gateway',
 *   token: 'your-token',
 * });
 * 
 * // Use the same API as WebContainers
 * await container.mount({
 *   'index.js': { file: { contents: 'console.log("Hello!")' } },
 * });
 * 
 * const process = await container.spawn('node', ['index.js']);
 * process.output.pipeTo(new WritableStream({
 *   write(data) { console.log(data); }
 * }));
 * 
 * const exitCode = await process.exit;
 * ```
 */

import { Sandbox } from 'computesdk';
import { createFileSystemAPI } from './filesystem';
import { spawnProcess } from './process';
import type {
  FileSystemAPI,
  FileSystemTree,
  WebContainerProcess,
  SpawnOptions,
  BootOptions,
  ConnectOptions,
  MountOptions,
  ExportOptions,
  PortListener,
  ErrorListener,
  ServerReadyListener,
  PreviewMessageListener,
  PreviewScriptOptions,
} from './types';

type EventType = 'port' | 'error' | 'server-ready' | 'preview-message';
type EventListener = PortListener | ErrorListener | ServerReadyListener | PreviewMessageListener;

/**
 * WebContainer-compatible interface for remote computesdk sandboxes
 */
export class WebContainer {
  private _sandbox: Sandbox;
  private _fs: FileSystemAPI;
  private _workdir: string;
  private _path: string;
  private _eventListeners: Map<EventType, Set<EventListener>> = new Map();
  private _signalService: any = null;
  private _isDestroyed = false;

  /**
   * Private constructor - use WebContainer.connect() to create instances
   */
  private constructor(sandbox: Sandbox, workdir: string) {
    this._sandbox = sandbox;
    this._workdir = workdir;
    this._path = '/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin';
    this._fs = createFileSystemAPI(sandbox, workdir);

    // Initialize event listener maps
    this._eventListeners.set('port', new Set());
    this._eventListeners.set('error', new Set());
    this._eventListeners.set('server-ready', new Set());
    this._eventListeners.set('preview-message', new Set());
  }

  /**
   * File system interface
   */
  get fs(): FileSystemAPI {
    return this._fs;
  }

  /**
   * Default PATH for spawned processes
   */
  get path(): string {
    return this._path;
  }

  /**
   * Working directory path
   */
  get workdir(): string {
    return this._workdir;
  }

  /**
   * Access to the underlying computesdk Sandbox (for advanced use cases)
   */
  get sandbox(): Sandbox {
    return this._sandbox;
  }

  // ============================================================================
  // Static Factory Methods
  // ============================================================================

  /** Singleton instance - only one WebContainer can be active at a time */
  private static _instance: WebContainer | null = null;

  /**
   * Boot a WebContainer
   * 
   * For remote sandboxes, this connects to an existing sandbox rather than
   * booting a new one. The sandbox URL and token can be:
   * 1. Passed explicitly in options
   * 2. Auto-detected from URL query parameters (?sandbox_url=...&session_token=...)
   * 3. Read from localStorage (sandbox_url, session_token)
   * 
   * Only one WebContainer instance can be active at a time. Call `teardown()`
   * before booting a new instance.
   * 
   * @param options - Boot options including optional connection details
   * @returns A WebContainer instance connected to the remote sandbox
   * 
   * @example
   * ```typescript
   * // Auto-detect from URL/localStorage
   * const container = await WebContainer.boot();
   * 
   * // Or explicit connection info
   * const container = await WebContainer.boot({
   *   sandboxUrl: 'https://sandbox-123.sandbox.computesdk.com',
   *   token: 'your-session-token',
   *   workdirName: 'my-project',
   * });
   * ```
   */
  static async boot(options: BootOptions = {}): Promise<WebContainer> {
    if (WebContainer._instance) {
      throw new Error(
        'A WebContainer instance is already running. ' +
        'Call teardown() before booting a new instance.'
      );
    }

    // Auto-detect sandbox URL and token from URL params or localStorage
    let sandboxUrl = options.sandboxUrl;
    let token = options.token;

    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      
      // Check URL parameters first
      const urlToken = params.get('session_token');
      const urlSandboxUrl = params.get('sandbox_url');
      
      // Clean up URL if params were found
      if (urlToken || urlSandboxUrl) {
        if (urlToken) {
          params.delete('session_token');
          localStorage.setItem('session_token', urlToken);
          token = token || urlToken;
        }
        if (urlSandboxUrl) {
          params.delete('sandbox_url');
          localStorage.setItem('sandbox_url', urlSandboxUrl);
          sandboxUrl = sandboxUrl || urlSandboxUrl;
        }
        
        // Update URL without the params
        const search = params.toString() ? `?${params.toString()}` : '';
        const newUrl = `${window.location.pathname}${search}${window.location.hash}`;
        window.history.replaceState({}, '', newUrl);
      }
      
      // Fall back to localStorage
      sandboxUrl = sandboxUrl || localStorage.getItem('sandbox_url') || undefined;
      token = token || localStorage.getItem('session_token') || undefined;
    }

    if (!sandboxUrl) {
      throw new Error(
        'No sandbox URL provided. Either:\n' +
        '1. Pass sandboxUrl in boot options\n' +
        '2. Include ?sandbox_url=... in the page URL\n' +
        '3. Set sandbox_url in localStorage'
      );
    }

    // Extract sandbox ID from URL (e.g., https://sandbox-123.sandbox.computesdk.com)
    const sandboxId = sandboxUrl.match(/\/\/([\w-]+)\./)?.[1] || 'unknown';

    const sandbox = new Sandbox({
      sandboxUrl: sandboxUrl.replace(/\/$/, ''),
      sandboxId,
      provider: 'gateway',
      token,
      timeout: options.timeout,
      protocol: options.protocol,
    });

    // Verify connection by checking health
    await sandbox.health();

    // Determine working directory
    const workdir = options.workdirName 
      ? `/home/${options.workdirName}`
      : '/home/project';

    // Ensure workdir exists
    try {
      await sandbox.runCommand(`mkdir -p "${workdir}"`);
    } catch {
      // Directory might already exist
    }

    const container = new WebContainer(sandbox, workdir);

    // Start signal service to handle port/error events
    await container._startSignalService();

    WebContainer._instance = container;
    return container;
  }

  /**
   * Connect to a remote computesdk sandbox (explicit configuration)
   * 
   * Use this method when you have explicit sandbox details. For simpler
   * usage with auto-detection, use `boot()` instead.
   * 
   * @param options - Connection options including sandbox URL, ID, and credentials
   * @returns A WebContainer instance connected to the remote sandbox
   * 
   * @example
   * ```typescript
   * const container = await WebContainer.connect({
   *   sandboxUrl: 'https://sandbox-123.sandbox.computesdk.com',
   *   sandboxId: 'sandbox-123',
   *   provider: 'gateway',
   *   token: 'your-session-token',
   * });
   * ```
   */
  static async connect(options: ConnectOptions): Promise<WebContainer> {
    if (WebContainer._instance) {
      throw new Error(
        'A WebContainer instance is already running. ' +
        'Call teardown() before connecting to a new instance.'
      );
    }

    const sandbox = new Sandbox({
      sandboxUrl: options.sandboxUrl,
      sandboxId: options.sandboxId,
      provider: options.provider,
      token: options.token,
      headers: options.headers,
      timeout: options.timeout,
      WebSocket: options.WebSocket,
      protocol: options.protocol,
    });

    // Verify connection by checking health
    await sandbox.health();

    // Determine working directory
    const workdir = options.workdirName 
      ? `/home/${options.workdirName}`
      : '/home/project';

    // Ensure workdir exists
    try {
      await sandbox.runCommand(`mkdir -p "${workdir}"`);
    } catch {
      // Directory might already exist
    }

    const container = new WebContainer(sandbox, workdir);

    // Start signal service to handle port/error events
    await container._startSignalService();

    WebContainer._instance = container;
    return container;
  }

  // ============================================================================
  // File System Operations
  // ============================================================================

  /**
   * Mount a file system tree into the container
   * 
   * @param tree - File system tree or binary snapshot
   * @param options - Mount options including mount point
   * 
   * @example
   * ```typescript
   * await container.mount({
   *   'src': {
   *     directory: {
   *       'index.js': { file: { contents: 'console.log("Hello!")' } },
   *       'utils.js': { file: { contents: 'export const add = (a, b) => a + b;' } },
   *     }
   *   },
   *   'package.json': { file: { contents: JSON.stringify({ name: 'my-app' }) } },
   * });
   * ```
   */
  async mount(
    tree: FileSystemTree | Uint8Array | ArrayBuffer,
    options?: MountOptions
  ): Promise<void> {
    this._ensureNotDestroyed();

    const mountPoint = options?.mountPoint || this._workdir;

    if (tree instanceof Uint8Array || tree instanceof ArrayBuffer) {
      // Binary snapshot - not yet supported
      throw new Error(
        'Binary snapshots are not yet supported. Please use FileSystemTree format.'
      );
    }

    // Mount the file system tree
    const mountFn = (this._fs as any)._mount;
    if (mountFn) {
      await mountFn(tree, mountPoint);
    }
  }

  // ============================================================================
  // Process Management
  // ============================================================================

  /**
   * Spawn a process in the container
   * 
   * @param command - Command to execute
   * @param args - Command arguments (optional)
   * @param options - Spawn options
   * @returns WebContainerProcess for interacting with the process
   * 
   * @example
   * ```typescript
   * // With arguments
   * const install = await container.spawn('npm', ['install']);
   * await install.exit;
   * 
   * // Without arguments
   * const shell = await container.spawn('bash');
   * shell.input.getWriter().write('echo "Hello"\n');
   * ```
   */
  async spawn(command: string, args?: string[], options?: SpawnOptions): Promise<WebContainerProcess>;
  async spawn(command: string, options?: SpawnOptions): Promise<WebContainerProcess>;
  async spawn(
    command: string, 
    argsOrOptions?: string[] | SpawnOptions, 
    maybeOptions?: SpawnOptions
  ): Promise<WebContainerProcess> {
    this._ensureNotDestroyed();

    let args: string[] = [];
    let options: SpawnOptions | undefined;

    if (Array.isArray(argsOrOptions)) {
      args = argsOrOptions;
      options = maybeOptions;
    } else {
      options = argsOrOptions;
    }

    // Set default cwd to workdir
    const spawnOptions: SpawnOptions = {
      ...options,
      cwd: options?.cwd || this._workdir,
    };

    return spawnProcess(this._sandbox, command, args, spawnOptions);
  }

  // ============================================================================
  // Event Handling
  // ============================================================================

  /**
   * Listen for events
   * 
   * @param event - Event type: 'port', 'error', 'server-ready', or 'preview-message'
   * @param listener - Event listener function
   * @returns Unsubscribe function
   * 
   * @example
   * ```typescript
   * // Listen for port events
   * const unsubscribe = container.on('port', (port, type, url) => {
   *   console.log(`Port ${port} ${type}: ${url}`);
   * });
   * 
   * // Listen for server-ready events
   * container.on('server-ready', (port, url) => {
   *   console.log(`Server ready at ${url}`);
   * });
   * 
   * // Unsubscribe later
   * unsubscribe();
   * ```
   */
  on(event: 'port', listener: PortListener): () => void;
  on(event: 'error', listener: ErrorListener): () => void;
  on(event: 'server-ready', listener: ServerReadyListener): () => void;
  on(event: 'preview-message', listener: PreviewMessageListener): () => void;
  on(event: EventType, listener: EventListener): () => void {
    const listeners = this._eventListeners.get(event);
    if (listeners) {
      listeners.add(listener);
    }

    return () => {
      listeners?.delete(listener);
    };
  }

  // ============================================================================
  // Export and Lifecycle
  // ============================================================================

  /**
   * Export the filesystem
   * 
   * @param path - Path to export
   * @param options - Export options
   * @returns FileSystemTree (json) or Uint8Array (binary/zip)
   * 
   * @example
   * ```typescript
   * // Export as JSON tree
   * const tree = await container.export('src', { format: 'json' });
   * 
   * // Export as zip
   * const zipData = await container.export('dist', { format: 'zip' });
   * const blob = new Blob([zipData], { type: 'application/zip' });
   * ```
   */
  async export(path: string, options?: ExportOptions): Promise<Uint8Array | FileSystemTree> {
    this._ensureNotDestroyed();

    const resolvedPath = path.startsWith('/') ? path : `${this._workdir}/${path}`;
    const format = options?.format || 'json';

    if (format === 'json') {
      // Build a FileSystemTree by reading the directory
      return this._exportAsTree(resolvedPath, options);
    } else {
      // Export as binary (zip or binary snapshot)
      // Use tar/zip command to create archive
      const tempFile = `/tmp/export-${Date.now()}.${format === 'zip' ? 'zip' : 'tar'}`;
      
      if (format === 'zip') {
        await this._sandbox.runCommand(`cd "${resolvedPath}" && zip -r "${tempFile}" .`);
      } else {
        await this._sandbox.runCommand(`tar -cf "${tempFile}" -C "${resolvedPath}" .`);
      }

      // Read the archive
      const content = await this._sandbox.filesystem.readFile(tempFile);
      
      // Clean up
      await this._sandbox.runCommand(`rm "${tempFile}"`);

      // Convert to Uint8Array
      return new TextEncoder().encode(content);
    }
  }

  /**
   * Configure a script to be injected into previews
   * 
   * Note: This is a no-op for remote sandboxes as preview injection
   * is handled differently.
   */
  async setPreviewScript(scriptSrc: string, options?: PreviewScriptOptions): Promise<void> {
    // No-op for remote sandboxes
    console.warn('setPreviewScript is not supported for remote sandboxes');
  }

  /**
   * Destroy the WebContainer instance and release resources
   * 
   * After calling this method, the instance becomes unusable.
   * Unlike local WebContainers, this does not terminate the remote sandbox -
   * it only disconnects from it. A new instance can be created by calling
   * `boot()` again.
   */
  teardown(): void {
    if (this._isDestroyed) {
      return;
    }

    this._isDestroyed = true;

    // Clear singleton reference
    WebContainer._instance = null;

    // Stop signal service
    if (this._signalService) {
      this._signalService.stop().catch(() => {});
      this._signalService = null;
    }

    // Clear event listeners
    this._eventListeners.forEach(listeners => listeners.clear());

    // Disconnect from sandbox
    this._sandbox.disconnect();
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  /**
   * Start the signal service to receive port/error events
   */
  private async _startSignalService(): Promise<void> {
    try {
      this._signalService = await this._sandbox.signal.start();

      this._signalService.on('port', (event: { port: number; type: 'open' | 'close'; url: string }) => {
        const listeners = this._eventListeners.get('port');
        listeners?.forEach((listener) => {
          (listener as PortListener)(event.port, event.type, event.url);
        });

        // Also emit server-ready for port open events
        if (event.type === 'open') {
          const serverReadyListeners = this._eventListeners.get('server-ready');
          serverReadyListeners?.forEach((listener) => {
            (listener as ServerReadyListener)(event.port, event.url);
          });
        }
      });

      this._signalService.on('error', (event: { message: string }) => {
        const listeners = this._eventListeners.get('error');
        listeners?.forEach((listener) => {
          (listener as ErrorListener)({ message: event.message });
        });
      });
    } catch (error) {
      // Signal service might not be available
      console.warn('Failed to start signal service:', error);
    }
  }

  /**
   * Export a directory as a FileSystemTree
   */
  private async _exportAsTree(
    path: string, 
    options?: ExportOptions
  ): Promise<FileSystemTree> {
    const tree: FileSystemTree = {};
    const entries = await this._sandbox.filesystem.readdir(path);

    for (const entry of entries) {
      const fullPath = `${path}/${entry.name}`;
      
      // Check excludes
      if (options?.excludes?.some(pattern => this._matchGlob(entry.name, pattern))) {
        // Check includes to see if it should be included anyway
        if (!options?.includes?.some(pattern => this._matchGlob(entry.name, pattern))) {
          continue;
        }
      }

      if (entry.type === 'directory') {
        tree[entry.name] = {
          directory: await this._exportAsTree(fullPath, options)
        };
      } else {
        const content = await this._sandbox.filesystem.readFile(fullPath);
        tree[entry.name] = {
          file: { contents: content }
        };
      }
    }

    return tree;
  }

  /**
   * Simple glob matching (supports * and **)
   */
  private _matchGlob(name: string, pattern: string): boolean {
    const regex = pattern
      .replace(/\*\*/g, '.*')
      .replace(/\*/g, '[^/]*')
      .replace(/\?/g, '.');
    return new RegExp(`^${regex}$`).test(name);
  }

  /**
   * Ensure the container is not destroyed
   */
  private _ensureNotDestroyed(): void {
    if (this._isDestroyed) {
      throw new Error('WebContainer has been destroyed');
    }
  }
}
