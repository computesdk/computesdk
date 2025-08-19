/**
 * ComputeSDK UI Types
 * 
 * Types and configurations for frontend integration with ComputeSDK APIs
 */

export type Runtime = 'node' | 'python';

/**
 * Sandbox status types (matches server-side)
 */
export type SandboxStatus = 'running' | 'stopped' | 'error';

/**
 * Request structure matching ComputeSDK request-handler API
 */
export interface ComputeRequest {
  /** Type of operation to perform */
  action: 
    // Sandbox operations
    | 'compute.sandbox.create' 
    | 'compute.sandbox.destroy' 
    | 'compute.sandbox.getInfo'
    | 'compute.sandbox.list'
    // Code execution
    | 'compute.sandbox.runCode'
    | 'compute.sandbox.runCommand'
    // Filesystem operations
    | 'compute.sandbox.filesystem.readFile'
    | 'compute.sandbox.filesystem.writeFile'
    | 'compute.sandbox.filesystem.mkdir'
    | 'compute.sandbox.filesystem.readdir'
    | 'compute.sandbox.filesystem.exists'
    | 'compute.sandbox.filesystem.remove';

  /** Sandbox ID (required for operations on existing sandboxes) */
  sandboxId?: string;
  
  /** Code to execute (for runCode action) */
  code?: string;
  
  /** Command to run (for runCommand action) */
  command?: string;
  
  /** Command arguments (for runCommand action) */
  args?: string[];
  
  /** Runtime environment */
  runtime?: Runtime;
  
  /** File path (for filesystem operations) */
  path?: string;
  
  /** File content (for writeFile action) */
  content?: string;
  
  /** Additional sandbox creation options */
  options?: {
    runtime?: Runtime;
    timeout?: number;
    sandboxId?: string;
  };
}

/**
 * Response structure matching ComputeSDK request-handler API
 */
export interface ComputeResponse {
  /** Whether the operation was successful */
  success: boolean;
  /** Error message if operation failed */
  error?: string;
  /** Sandbox ID involved in the operation */
  sandboxId: string;
  /** Provider that handled the operation */
  provider: string;
  
  /** Execution result (for runCode/runCommand actions) */
  result?: {
    stdout: string;
    stderr: string;
    exitCode: number;
    executionTime: number;
  };
  
  /** Sandbox info (for getInfo action) */
  info?: {
    id: string;
    provider: string;
    runtime: Runtime;
    status: SandboxStatus;
    createdAt: string;
    timeout: number;
    metadata?: Record<string, unknown>;
  };
  
  /** File content (for readFile action) */
  fileContent?: string;
  
  /** Directory listing (for readdir action) */
  files?: Array<{
    name: string;
    path: string;
    isDirectory: boolean;
    size: number;
    lastModified: string;
  }>;
  
  /** File/directory exists (for exists action) */
  exists?: boolean;
  
  /** Sandbox list (for list action) */
  sandboxes?: Array<{
    sandboxId: string;
    provider: string;
  }>;
  
}



/**
 * Configuration for compute API integration
 */
export interface ComputeConfig {
  /** API endpoint for compute operations */
  apiEndpoint: string;
  /** Default runtime to use */
  defaultRuntime?: Runtime;
  /** Request timeout in milliseconds */
  timeout?: number;
  /** Number of retry attempts */
  retries?: number;
  /** Enable request validation */
  validateRequests?: boolean;
}

/**
 * Validation result structure
 */
export interface ValidationResult {
  isValid: boolean;
  errors: string[];
}

/**
 * Console entry for REPL-style interaction history
 */
export interface ConsoleEntry {
  /** Unique ID for this entry */
  id: string;
  /** Type of entry */
  type: 'input' | 'output' | 'error';
  /** Content of the entry */
  content: string;
  /** Runtime used for execution (if input) */
  runtime?: Runtime;
  /** Timestamp when entry was created */
  timestamp: Date;
  /** Execution result (if input type) */
  result?: {
    stdout: string;
    stderr: string;
    exitCode: number;
    executionTime: number;
  };
}

/**
 * Console result for individual code executions
 */
export interface ConsoleResult {
  /** Whether execution was successful */
  success: boolean;
  /** Standard output */
  stdout: string;
  /** Standard error */
  stderr: string;
  /** Exit code */
  exitCode: number;
  /** Execution time in milliseconds */
  executionTime: number;
  /** Error message if execution failed */
  error?: string;
}

/**
 * UI Console interface - REPL-style code execution with history
 */
export interface UIConsole {
  /** Sandbox ID this console is connected to */
  sandboxId: string;
  
  /** Execute code and maintain context/history */
  runCode: (code: string, runtime?: Runtime) => Promise<ConsoleResult>;
  
  /** Run shell command (non-persistent) */
  runCommand: (command: string, args?: string[]) => Promise<ConsoleResult>;
  
  /** Console history entries */
  history: ConsoleEntry[];
  
  /** Whether console is currently executing */
  isRunning: boolean;
  
  /** Current runtime environment */
  currentRuntime: Runtime;
  
  /** Clear console history */
  clear: () => void;
  

  
  /** Get current execution context/variables */
  getContext: () => Promise<Record<string, unknown>>;
}

/**
 * UI Filesystem interface - file operations with better UX
 */
export interface UIFilesystem {
  /** Sandbox ID this filesystem is connected to */
  sandboxId: string;
  
  /** Read file content */
  readFile: (path: string) => Promise<string>;
  
  /** Write file content */
  writeFile: (path: string, content: string) => Promise<void>;
  
  /** Create directory */
  mkdir: (path: string) => Promise<void>;
  
  /** List directory contents */
  readdir: (path: string) => Promise<Array<{
    name: string;
    path: string;
    isDirectory: boolean;
    size: number;
    lastModified: string;
  }>>;
  
  /** Check if file/directory exists */
  exists: (path: string) => Promise<boolean>;
  
  /** Remove file or directory */
  remove: (path: string) => Promise<void>;
}

/**
 * UI Sandbox interface - sandbox lifecycle management
 */
export interface UISandbox {
  /** Sandbox ID */
  id: string;
  /** Provider handling this sandbox */
  provider: string;
  /** Current sandbox status */
  status: SandboxStatus;
  /** Runtime environment */
  runtime: Runtime;
  
  /** Execute code in the sandbox (simple execution) */
  runCode: (code: string, runtime?: Runtime) => Promise<ComputeResponse>;
  
  /** Run shell commands */
  runCommand: (command: string, args?: string[]) => Promise<ComputeResponse>;
  
  /** Get sandbox information */
  getInfo: () => Promise<ComputeResponse>;
  
  /** Destroy the sandbox */
  destroy: () => Promise<ComputeResponse>;
  
  /** Filesystem operations */
  filesystem: {
    readFile: (path: string) => Promise<ComputeResponse>;
    writeFile: (path: string, content: string) => Promise<ComputeResponse>;
    mkdir: (path: string) => Promise<ComputeResponse>;
    readdir: (path: string) => Promise<ComputeResponse>;
    exists: (path: string) => Promise<ComputeResponse>;
    remove: (path: string) => Promise<ComputeResponse>;
  };
}

/**
 * Configuration for createSandboxConsole factory
 */
export interface SandboxConsoleConfig {
  /** Sandbox ID to connect console to */
  sandboxId: string;
  /** API endpoint for compute operations */
  apiEndpoint?: string;
  /** Default runtime for console */
  defaultRuntime?: Runtime;
  /** Maximum history entries to keep */
  maxHistoryEntries?: number;
}

/**
 * Configuration for createSandboxFilesystem factory
 */
export interface SandboxFilesystemConfig {
  /** Sandbox ID to connect filesystem to */
  sandboxId: string;
  /** API endpoint for compute operations */
  apiEndpoint?: string;
}

/**
 * Configuration for createSandbox factory
 */
export interface SandboxConfig {
  /** Sandbox ID */
  sandboxId: string;
  /** Provider name */
  provider: string;
  /** Runtime environment */
  runtime: Runtime;
  /** Sandbox status */
  status: SandboxStatus;
  /** API endpoint for compute operations */
  apiEndpoint: string;
}



/**
 * Theme configuration for UI components
 */
export interface Theme {
  colors: {
    primary: string;
    secondary: string;
    success: string;
    error: string;
    warning: string;
    background: string;
    surface: string;
    text: string;
    textSecondary: string;
    border: string;
  };
  spacing: {
    xs: string;
    sm: string;
    md: string;
    lg: string;
    xl: string;
  };
  typography: {
    fontFamily: string;
    fontMono: string;
    fontSize: {
      sm: string;
      base: string;
      lg: string;
      xl: string;
    };
  };
  borderRadius: {
    sm: string;
    md: string;
    lg: string;
  };
}