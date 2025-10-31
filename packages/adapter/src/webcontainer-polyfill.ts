/**
 * WebContainer API Polyfill
 *
 * This provides a WebContainer-compatible API backed by ComputeSDK's remote sandboxes.
 * Instead of running Node.js in the browser, this proxies to your remote sandbox infrastructure.
 *
 * @example
 * ```typescript
 * import { WebContainer } from '@computesdk/adapter/webcontainer';
 *
 * // Drop-in replacement for @webcontainer/api!
 * const wc = await WebContainer.boot({
 *   sandboxUrl: 'https://sandbox-123.preview.computesdk.com'
 * });
 *
 * await wc.fs.writeFile('/hello.js', 'console.log("Hello!")');
 * const process = await wc.spawn('node', ['hello.js']);
 * ```
 */

import { ComputeAdapter, type ComputeAdapterConfig } from './index';
import type { Terminal } from './terminal';
import type { SignalService } from './signal-service';

// ============================================================================
// Type Definitions (matching WebContainer API)
// ============================================================================

/**
 * File node - represents a file with contents
 */
export interface FileNode {
  file: {
    contents: string | Uint8Array;
  };
}

/**
 * Directory node - represents a directory
 */
export interface DirectoryNode {
  directory: FileSystemTree;
}

/**
 * Symlink node - represents a symbolic link
 */
export interface SymlinkNode {
  file: {
    symlink: string;
  };
}

/**
 * File system tree structure
 */
export interface FileSystemTree {
  [name: string]: FileNode | DirectoryNode | SymlinkNode;
}

/**
 * Options for booting a WebContainer
 */
export interface BootOptions extends ComputeAdapterConfig {
  coep?: 'require-corp' | 'credentialless' | 'none';
  workdirName?: string;
  forwardPreviewErrors?: boolean | 'exceptions-only';
}

/**
 * Options for spawning a process
 */
export interface SpawnOptions {
  cwd?: string;
  env?: Record<string, string | number | boolean>;
  output?: boolean;
  terminal?: { cols: number; rows: number };
}

/**
 * Buffer encoding types
 */
export type BufferEncoding =
  | 'ascii'
  | 'utf8'
  | 'utf-8'
  | 'utf16le'
  | 'ucs2'
  | 'ucs-2'
  | 'base64'
  | 'base64url'
  | 'latin1'
  | 'binary'
  | 'hex';

/**
 * Directory entry
 */
export interface DirEnt {
  name: string | Uint8Array;
  isDirectory(): boolean;
  isFile(): boolean;
}

/**
 * WebContainer process - compatible with WebContainer API
 */
export class WebContainerProcess {
  private terminal: Terminal;
  private outputBuffer: string = '';
  private exitCode: number | null = null;

  /** Promise that resolves with the exit code */
  public exit: Promise<number>;

  /** Output stream (read-only) */
  public output: ReadableStream<string>;

  /** Input stream (write-only) */
  public input: WritableStream<string>;

  constructor(terminal: Terminal) {
    this.terminal = terminal;

    // Create output stream from terminal events
    this.output = new ReadableStream<string>({
      start: (controller) => {
        terminal.on('output', (data: string) => {
          this.outputBuffer += data;
          controller.enqueue(data);
        });

        terminal.on('destroyed', () => {
          controller.close();
        });
      }
    });

    // Create input stream that writes to terminal
    this.input = new WritableStream<string>({
      write: (chunk) => {
        terminal.write(chunk);
      }
    });

    // Exit promise - resolved when terminal is destroyed or command completes
    this.exit = new Promise<number>((resolve) => {
      terminal.on('destroyed', () => {
        resolve(this.exitCode ?? 0);
      });

      // Parse output for exit codes
      terminal.on('output', (data: string) => {
        const exitMatch = data.match(/Process exited with code (\d+)/);
        if (exitMatch) {
          this.exitCode = parseInt(exitMatch[1], 10);
        }
      });
    });
  }

  /**
   * Kill the process
   */
  kill(): void {
    this.terminal.destroy().catch(() => {
      // Ignore errors on kill
    });
  }

  /**
   * Resize the terminal
   */
  resize(dimensions: { cols: number; rows: number }): void {
    this.terminal.resize(dimensions.cols, dimensions.rows);
  }
}

/**
 * File system API - compatible with WebContainer fs.promises API
 */
export class FileSystemAPI {
  constructor(private adapter: ComputeAdapter) {}

  /**
   * Create a directory
   */
  async mkdir(path: string, options?: { recursive?: boolean }): Promise<void> {
    // For recursive, we'd need to create parent directories
    // For now, just create the directory via a file operation
    await this.adapter.createFile(path + '/.keep', '');
  }

  /**
   * Read directory contents
   */
  async readdir(
    path: string,
    options?: { encoding?: BufferEncoding; withFileTypes?: boolean }
  ): Promise<string[] | DirEnt[]> {
    const response = await this.adapter.listFiles(path);
    const files = response.data.files;

    if (options?.withFileTypes) {
      return files.map(f => {
        // Handle both snake_case and PascalCase from API
        const name = (f as any).Name || f.name;
        const isDir = (f as any).IsDir !== undefined ? (f as any).IsDir : f.is_dir;
        return {
          name,
          isDirectory: () => isDir,
          isFile: () => !isDir
        } as DirEnt;
      });
    }

    return files.map(f => (f as any).Name || f.name);
  }

  /**
   * Read file contents
   */
  async readFile(
    path: string,
    encoding?: BufferEncoding | null
  ): Promise<string | Uint8Array> {
    const content = await this.adapter.readFile(path);

    if (encoding === null || encoding === undefined) {
      // Return as Uint8Array
      return new TextEncoder().encode(content);
    }

    // Return as string (with encoding applied)
    return content;
  }

  /**
   * Write file contents
   */
  async writeFile(
    path: string,
    data: string | Uint8Array,
    options?: string | { encoding?: null | BufferEncoding } | null
  ): Promise<void> {
    let content: string;

    if (data instanceof Uint8Array) {
      content = new TextDecoder().decode(data);
    } else {
      content = data;
    }

    await this.adapter.writeFile(path, content);
  }

  /**
   * Rename a file
   */
  async rename(oldPath: string, newPath: string): Promise<void> {
    // Read old file
    const content = await this.readFile(oldPath, 'utf-8') as string;

    // Write to new location
    await this.writeFile(newPath, content);

    // Delete old file
    await this.rm(oldPath);
  }

  /**
   * Remove a file or directory
   */
  async rm(path: string, options?: { force?: boolean; recursive?: boolean }): Promise<void> {
    try {
      await this.adapter.deleteFile(path);
    } catch (error) {
      if (!options?.force) {
        throw error;
      }
    }
  }

  /**
   * Watch for file changes
   */
  watch(
    path: string,
    options: { encoding?: BufferEncoding | null; recursive?: boolean } | undefined,
    listener: (event: 'rename' | 'change', filename: string | Buffer) => void
  ): { close(): void } {
    let watcher: any = null;

    // Start watching
    this.adapter.createWatcher(path, {
      includeContent: false,
      ignored: []
    }).then(w => {
      watcher = w;

      w.on('change', (event) => {
        // Map file events to WebContainer events
        const eventType = event.event === 'change' ? 'change' : 'rename';
        listener(eventType, event.path);
      });
    });

    return {
      close: () => {
        if (watcher) {
          watcher.destroy();
        }
      }
    };
  }
}

/**
 * WebContainer - main class that polyfills the WebContainer API
 */
export class WebContainer {
  private adapter: ComputeAdapter;
  private signalService: SignalService | null = null;
  private eventHandlers: Map<string, Set<Function>> = new Map();

  /** File system API */
  public fs: FileSystemAPI;

  /** Working directory */
  public workdir: string = '/home/project';

  /** PATH environment variable */
  public path: string = '/usr/local/bin:/usr/bin:/bin';

  private constructor(adapter: ComputeAdapter) {
    this.adapter = adapter;
    this.fs = new FileSystemAPI(adapter);
  }

  /**
   * Boot a WebContainer instance
   * This is the main entry point - compatible with WebContainer.boot()
   */
  static async boot(options: BootOptions): Promise<WebContainer> {
    // Create adapter
    const adapter = new ComputeAdapter(options);

    // Generate token (first-come-first-served auth)
    try {
      await adapter.generateToken();
    } catch (error) {
      // Token might already be claimed, try to use existing connection
      console.warn('Failed to generate token, using existing connection');
    }

    const container = new WebContainer(adapter);

    // Start signal service to monitor ports
    container.signalService = await adapter.startSignals();

    // Forward signal events to WebContainer event handlers
    container.signalService.on('port', (event) => {
      if (event.type === 'open') {
        container.emit('port', event.port, 'open', event.url);
        container.emit('server-ready', event.port, event.url);
      } else {
        container.emit('port', event.port, 'close', event.url);
      }
    });

    container.signalService.on('error', (event) => {
      container.emit('error', { message: event.message });
    });

    return container;
  }

  /**
   * Mount a file system tree
   */
  async mount(
    tree: FileSystemTree | Uint8Array | ArrayBuffer,
    options?: { mountPoint?: string }
  ): Promise<void> {
    const basePath = options?.mountPoint || this.workdir;

    // If it's binary data, we can't easily parse it without @webcontainer/snapshot
    if (tree instanceof Uint8Array || tree instanceof ArrayBuffer) {
      throw new Error('Binary snapshots not yet supported in polyfill');
    }

    // Recursively mount the tree
    await this.mountTree(tree, basePath);
  }

  /**
   * Recursively mount a file tree
   */
  private async mountTree(tree: FileSystemTree, basePath: string): Promise<void> {
    for (const [name, node] of Object.entries(tree)) {
      const fullPath = `${basePath}/${name}`;

      if ('directory' in node) {
        // Create directory
        await this.fs.mkdir(fullPath);
        // Recursively mount subdirectory
        await this.mountTree(node.directory, fullPath);
      } else if ('file' in node) {
        if ('contents' in node.file) {
          // Write file
          await this.fs.writeFile(fullPath, node.file.contents);
        } else if ('symlink' in node.file) {
          // Symlinks not yet supported
          console.warn(`Symlinks not yet supported: ${fullPath} -> ${node.file.symlink}`);
        }
      }
    }
  }

  /**
   * Spawn a process
   */
  async spawn(
    command: string,
    args?: string[],
    options?: SpawnOptions
  ): Promise<WebContainerProcess>;
  async spawn(
    command: string,
    options?: SpawnOptions
  ): Promise<WebContainerProcess>;
  async spawn(
    command: string,
    argsOrOptions?: string[] | SpawnOptions,
    options?: SpawnOptions
  ): Promise<WebContainerProcess> {
    // Parse arguments
    let args: string[] = [];
    let spawnOptions: SpawnOptions = {};

    if (Array.isArray(argsOrOptions)) {
      args = argsOrOptions;
      spawnOptions = options || {};
    } else if (argsOrOptions) {
      spawnOptions = argsOrOptions;
    }

    // Create terminal with proper dimensions
    const terminal = await this.adapter.createTerminal();

    if (spawnOptions.terminal) {
      terminal.resize(spawnOptions.terminal.cols, spawnOptions.terminal.rows);
    }

    // Build full command with args
    const fullCommand = args.length > 0 ? `${command} ${args.join(' ')}` : command;

    // Execute command in terminal
    terminal.write(fullCommand + '\n');

    return new WebContainerProcess(terminal);
  }

  /**
   * Export the file system
   */
  async export(
    path: string,
    options?: { format?: 'json' | 'binary' | 'zip' }
  ): Promise<Uint8Array | FileSystemTree> {
    if (options?.format === 'json') {
      // Export as FileSystemTree
      const files = await this.fs.readdir(path, { withFileTypes: true });
      const tree: FileSystemTree = {};

      for (const file of files as DirEnt[]) {
        const fullPath = `${path}/${file.name}`;

        if (file.isDirectory()) {
          const subTree = await this.export(fullPath, { format: 'json' }) as FileSystemTree;
          tree[file.name as string] = { directory: subTree };
        } else {
          const content = await this.fs.readFile(fullPath, 'utf-8') as string;
          tree[file.name as string] = { file: { contents: content } };
        }
      }

      return tree;
    } else {
      // Binary format not yet supported
      throw new Error('Binary export not yet supported in polyfill');
    }
  }

  /**
   * Listen for events
   */
  on(
    event: 'port',
    listener: (port: number, type: 'open' | 'close', url: string) => void
  ): () => void;
  on(
    event: 'error',
    listener: (error: { message: string }) => void
  ): () => void;
  on(
    event: 'server-ready',
    listener: (port: number, url: string) => void
  ): () => void;
  on(event: string, listener: (...args: any[]) => void): () => void {
    if (!this.eventHandlers.has(event)) {
      this.eventHandlers.set(event, new Set());
    }
    this.eventHandlers.get(event)!.add(listener);

    // Return unsubscribe function
    return () => {
      const handlers = this.eventHandlers.get(event);
      if (handlers) {
        handlers.delete(listener);
      }
    };
  }

  /**
   * Emit event
   */
  private emit(event: string, ...args: any[]): void {
    const handlers = this.eventHandlers.get(event);
    if (handlers) {
      handlers.forEach(handler => {
        try {
          handler(...args);
        } catch (error) {
          console.error(`Error in WebContainer event handler (${event}):`, error);
        }
      });
    }
  }

  /**
   * Teardown the WebContainer
   */
  async teardown(): Promise<void> {
    // Stop signal service
    if (this.signalService) {
      await this.signalService.stop();
    }

    // Disconnect adapter
    await this.adapter.disconnect();

    // Clear event handlers
    this.eventHandlers.clear();
  }
}

// Export additional helpers
export { ComputeAdapter as __ComputeAdapter };