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
    | 'compute.sandbox.filesystem.remove'
    // Terminal operations
    | 'compute.sandbox.terminal.create'
    | 'compute.sandbox.terminal.list';

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
  
  /** Terminal options (for terminal.create) */
  terminalOptions?: {
    command?: string;
    cols?: number;
    rows?: number;
    env?: Record<string, string>;
  };
  
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
    metadata?: Record<string, any>;
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
  
  /** Terminal session (for terminal.create action) */
  terminal?: {
    pid: number;
    command: string;
    status: string;
    cols: number;
    rows: number;
  };
  
  /** Terminal sessions (for terminal.list action) */
  terminals?: Array<{
    pid: number;
    command: string;
    status: string;
    cols: number;
    rows: number;
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
 * Frontend sandbox interface - mirrors server-side capabilities
 */
export interface FrontendSandbox {
  /** Sandbox ID */
  id: string;
  /** Provider handling this sandbox */
  provider: string;
  
  /** Execute code in the sandbox */
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
  
  /** Terminal operations */
  terminal: {
    create: (options?: {
      command?: string;
      cols?: number;
      rows?: number;
      env?: Record<string, string>;
    }) => Promise<ComputeResponse>;
    list: () => Promise<ComputeResponse>;
  };
}

/**
 * Compute hook return type - will expand to include blob, database, git
 */
export interface ComputeHook {
  /** Sandbox management */
  sandbox: {
    /** Create a new sandbox */
    create: (options?: { runtime?: Runtime; timeout?: number }) => Promise<FrontendSandbox>;
    /** Get existing sandbox by ID */
    get: (sandboxId: string) => Promise<FrontendSandbox | null>;
    /** List all sandboxes */
    list: () => Promise<FrontendSandbox[]>;
    /** Destroy a sandbox */
    destroy: (sandboxId: string) => Promise<void>;
  };
  
  // Future expansion:
  // blob: BlobOperations;
  // database: DatabaseOperations;
  // git: GitOperations;
}

/**
 * Configuration for useCompute hook
 */
export interface UseComputeConfig {
  /** API endpoint for compute operations */
  apiEndpoint?: string;
  /** Default runtime for new sandboxes */
  defaultRuntime?: Runtime;
  /** Request timeout in milliseconds */
  timeout?: number;
  /** Number of retry attempts */
  retries?: number;
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