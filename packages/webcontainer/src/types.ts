/**
 * WebContainer-compatible types for computesdk
 * 
 * This module provides type definitions that mirror the WebContainer API,
 * allowing code written for WebContainers to work with remote computesdk sandboxes.
 * 
 * @see https://webcontainers.io/api
 */

// ============================================================================
// Buffer Encoding
// ============================================================================

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

// ============================================================================
// File System Types
// ============================================================================

/**
 * File node in the filesystem tree
 */
export interface FileNode {
  file: {
    contents: string | Uint8Array;
  };
}

/**
 * Symlink node in the filesystem tree
 */
export interface SymlinkNode {
  file: {
    symlink: string;
  };
}

/**
 * Directory node in the filesystem tree
 */
export interface DirectoryNode {
  directory: FileSystemTree;
}

/**
 * Tree structure representing files and directories
 */
export interface FileSystemTree {
  [name: string]: FileNode | SymlinkNode | DirectoryNode;
}

/**
 * Directory entry returned by readdir
 */
export interface DirEnt<T = string> {
  name: T;
  isDirectory(): boolean;
  isFile(): boolean;
}

/**
 * Options for mkdir
 */
export interface MkdirOptions {
  recursive?: boolean;
}

/**
 * Options for readdir
 */
export interface ReaddirOptions {
  encoding?: BufferEncoding;
  withFileTypes?: boolean;
}

/**
 * Options for rm
 */
export interface RmOptions {
  force?: boolean;
  recursive?: boolean;
}

/**
 * Options for watch
 */
export interface WatchOptions {
  encoding?: BufferEncoding | null;
  recursive?: boolean;
}

/**
 * Watch listener callback
 */
export type WatchListener = (event: 'rename' | 'change', filename: string | Buffer) => void;

/**
 * File system watcher
 */
export interface Watcher {
  close(): void;
}

/**
 * File system API matching WebContainer's fs interface
 */
export interface FileSystemAPI {
  mkdir(path: string, options?: MkdirOptions): Promise<void>;
  readdir(path: string, options?: ReaddirOptions): Promise<string[] | DirEnt<string>[]>;
  readFile(path: string, encoding?: BufferEncoding | null): Promise<Uint8Array | string>;
  rename(oldPath: string, newPath: string): Promise<void>;
  rm(path: string, options?: RmOptions): Promise<void>;
  writeFile(path: string, data: string | Uint8Array, options?: string | { encoding?: BufferEncoding | null } | null): Promise<void>;
  watch(path: string, options: WatchOptions, listener: WatchListener): Watcher;
  watch(path: string, listener: WatchListener): Watcher;
}

// ============================================================================
// Process Types
// ============================================================================

/**
 * Options for spawning a process
 */
export interface SpawnOptions {
  /** Current working directory for the process */
  cwd?: string;
  /** Environment variables for the process */
  env?: Record<string, string | number | boolean>;
  /** Whether to receive output (default: true) */
  output?: boolean;
  /** Terminal size for PTY mode */
  terminal?: { cols: number; rows: number };
}

/**
 * A running process in the WebContainer
 */
export interface WebContainerProcess {
  /** Promise that resolves with the exit code */
  exit: Promise<number>;
  /** Writable stream for process input */
  input: WritableStream<string>;
  /** Readable stream for process output */
  output: ReadableStream<string>;
  /** Kill the process */
  kill(): void;
  /** Resize the terminal */
  resize(dimensions: { cols: number; rows: number }): void;
}

// ============================================================================
// Export Types
// ============================================================================

/**
 * Options for exporting the filesystem
 */
export interface ExportOptions {
  /** Export format */
  format?: 'json' | 'binary' | 'zip';
  /** Glob patterns to include from excluded folders */
  includes?: string[];
  /** Glob patterns to exclude */
  excludes?: string[];
}

// ============================================================================
// Preview Types
// ============================================================================

export enum PreviewMessageType {
  UncaughtException = 'uncaught-exception',
  UnhandledRejection = 'unhandled-rejection',
  ConsoleError = 'console-error',
}

export interface BasePreviewMessage {
  previewId: string;
  port: number;
  pathname: string;
  search: string;
  hash: string;
}

export interface UncaughtExceptionMessage {
  type: PreviewMessageType.UncaughtException;
  message: string;
  stack: string | undefined;
}

export interface UnhandledRejectionMessage {
  type: PreviewMessageType.UnhandledRejection;
  message: string;
  stack: string | undefined;
}

export interface ConsoleErrorMessage {
  type: PreviewMessageType.ConsoleError;
  args: any[];
  stack: string;
}

export type PreviewMessage = (UncaughtExceptionMessage | UnhandledRejectionMessage | ConsoleErrorMessage) & BasePreviewMessage;

/**
 * Options for preview scripts
 */
export interface PreviewScriptOptions {
  type?: 'module' | 'importmap';
  defer?: boolean;
  async?: boolean;
}

// ============================================================================
// Event Listeners
// ============================================================================

/**
 * Listener for port events
 */
export type PortListener = (port: number, type: 'open' | 'close', url: string) => void;

/**
 * Listener for error events
 */
export type ErrorListener = (error: { message: string }) => void;

/**
 * Listener for server-ready events
 */
export type ServerReadyListener = (port: number, url: string) => void;

/**
 * Listener for preview message events
 */
export type PreviewMessageListener = (message: PreviewMessage) => void;

// ============================================================================
// Boot/Connect Options
// ============================================================================

/**
 * Options for booting a WebContainer
 * 
 * For remote sandboxes, extends the standard WebContainer BootOptions
 * with connection information. The sandbox URL and token can be provided
 * explicitly or auto-detected from URL parameters / localStorage.
 * 
 * @see https://webcontainers.io/api#boot-options
 */
export interface BootOptions {
  /** COEP header configuration (ignored for remote sandboxes) */
  coep?: 'require-corp' | 'credentialless' | 'none';
  /** Working directory name */
  workdirName?: string;
  /** Forward preview errors (ignored for remote sandboxes) */
  forwardPreviewErrors?: boolean | 'exceptions-only';
  
  // Remote sandbox connection options (computesdk extension)
  /** Sandbox URL - auto-detected from URL params or localStorage if not provided */
  sandboxUrl?: string;
  /** Authentication token - auto-detected from URL params or localStorage if not provided */
  token?: string;
  /** Request timeout in milliseconds */
  timeout?: number;
  /** WebSocket protocol */
  protocol?: 'json' | 'binary';
}

/**
 * Options for connecting to a remote sandbox (computesdk extension)
 */
export interface ConnectOptions {
  /** Sandbox URL (e.g., https://sandbox-123.sandbox.computesdk.com) */
  sandboxUrl: string;
  /** Sandbox ID */
  sandboxId: string;
  /** Provider name (e.g., 'e2b', 'gateway') */
  provider: string;
  /** Authentication token */
  token?: string;
  /** Additional headers */
  headers?: Record<string, string>;
  /** Request timeout in milliseconds */
  timeout?: number;
  /** WebSocket implementation (for Node.js) */
  WebSocket?: new (url: string) => WebSocket;
  /** WebSocket protocol */
  protocol?: 'json' | 'binary';
  /** Working directory name */
  workdirName?: string;
}

/**
 * Options that can be passed to mount()
 */
export interface MountOptions {
  /** Mount point path */
  mountPoint?: string;
}

// ============================================================================
// Auth Types (for private package support)
// ============================================================================

export interface AuthInitOptions {
  /** StackBlitz origin (default: https://stackblitz.com) */
  editorOrigin?: string;
  /** OAuth client ID */
  clientId: string;
  /** OAuth scope */
  scope: string;
}

export interface AuthFailedError {
  status: 'auth-failed';
  error: string;
  description: string;
}

export type AuthInitResult = 
  | { status: 'need-auth' | 'authorized' }
  | AuthFailedError;
