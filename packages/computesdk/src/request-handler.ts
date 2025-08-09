/**
 * Request Handler for Web Framework Integration
 * 
 * Maps web requests to ComputeSDK operations with comprehensive support for:
 * - Sandbox management (create, destroy, getInfo)
 * - Code execution
 * - Filesystem operations
 * - Terminal operations
 */

import type { Provider, Runtime, Sandbox } from './types';
import { compute } from './compute';

/**
 * Extended request structure supporting all SDK capabilities
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
 * Response structure for compute operations
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
    status: string;
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
 * Parameters for handleComputeRequest
 */
export interface HandleComputeRequestParams {
  /** The compute request to handle */
  request: ComputeRequest;
  /** Provider to use for the operation */
  provider: Provider;
}

/**
 * Handle a compute request - unified API for web frameworks
 * 
 * Maps web requests to ComputeSDK operations with full support for:
 * - All sandbox operations via compute.sandbox.*
 * - All filesystem operations via sandbox.filesystem.*
 * - All terminal operations via sandbox.terminal.*
 * 
 * @example
 * ```typescript
 * // Execute code
 * const response = await handleComputeRequest({
 *   request: { 
 *     action: 'sandbox.runCode', 
 *     code: 'print("hello")',
 *     sandboxId: 'existing-sandbox-id' // optional, creates new if not provided
 *   },
 *   provider: e2b({ apiKey: process.env.E2B_API_KEY })
 * });
 * 
 * // Filesystem operations
 * const response = await handleComputeRequest({
 *   request: { 
 *     action: 'filesystem.writeFile', 
 *     sandboxId: 'sandbox-id',
 *     path: '/tmp/hello.py',
 *     content: 'print("Hello from file!")'
 *   },
 *   provider: e2b({ apiKey: process.env.E2B_API_KEY })
 * });
 * ```
 */
export async function handleComputeRequest(params: HandleComputeRequestParams): Promise<ComputeResponse> {
  const { request, provider } = params;
  
  try {
    // Helper function to get or create sandbox
    const getSandbox = async (sandboxId?: string): Promise<Sandbox> => {
      if (sandboxId) {
        const existingSandbox = await compute.sandbox.getById(provider, sandboxId);
        if (!existingSandbox) {
          throw new Error(`Sandbox with ID ${sandboxId} not found`);
        }
        return existingSandbox;
      } else {
        // Create new sandbox
        return await compute.sandbox.create({
          provider,
          options: request.options || { runtime: 'python' }
        });
      }
    };

    switch (request.action) {
      // Sandbox operations
      case 'compute.sandbox.create': {
        const sandbox = await compute.sandbox.create({
          provider,
          options: request.options || { runtime: 'python' }
        });

        return {
          success: true,
          sandboxId: sandbox.sandboxId,
          provider: provider.name
        };
      }

      case 'compute.sandbox.destroy': {
        if (!request.sandboxId) {
          return {
            success: false,
            error: 'Sandbox ID is required for destroy action',
            sandboxId: '',
            provider: provider.name
          };
        }

        await compute.sandbox.destroy(provider, request.sandboxId);
        
        return {
          success: true,
          sandboxId: request.sandboxId,
          provider: provider.name
        };
      }

      case 'compute.sandbox.getInfo': {
        if (!request.sandboxId) {
          return {
            success: false,
            error: 'Sandbox ID is required for getInfo action',
            sandboxId: '',
            provider: provider.name
          };
        }

        const sandbox = await getSandbox(request.sandboxId);
        const info = await sandbox.getInfo();
        
        return {
          success: true,
          sandboxId: request.sandboxId,
          provider: provider.name,
          info: {
            id: info.id,
            provider: info.provider,
            runtime: info.runtime,
            status: info.status,
            createdAt: info.createdAt.toISOString(),
            timeout: info.timeout,
            metadata: info.metadata
          }
        };
      }

      case 'compute.sandbox.list': {
        const sandboxes = await compute.sandbox.list(provider);
        
        return {
          success: true,
          sandboxId: '',
          provider: provider.name,
          sandboxes: sandboxes.map(sandbox => ({
            sandboxId: sandbox.sandboxId,
            provider: sandbox.provider
          }))
        };
      }

      // Code execution
      case 'compute.sandbox.runCode': {
        if (!request.code) {
          return {
            success: false,
            error: 'Code is required for runCode action',
            sandboxId: request.sandboxId || '',
            provider: provider.name
          };
        }

        const sandbox = await getSandbox(request.sandboxId);
        const result = await sandbox.runCode(request.code, request.runtime);
        
        return {
          success: true,
          sandboxId: sandbox.sandboxId,
          provider: provider.name,
          result: {
            stdout: result.stdout,
            stderr: result.stderr,
            exitCode: result.exitCode,
            executionTime: result.executionTime
          }
        };
      }

      case 'compute.sandbox.runCommand': {
        if (!request.command) {
          return {
            success: false,
            error: 'Command is required for runCommand action',
            sandboxId: request.sandboxId || '',
            provider: provider.name
          };
        }

        const sandbox = await getSandbox(request.sandboxId);
        const result = await sandbox.runCommand(request.command, request.args);
        
        return {
          success: true,
          sandboxId: sandbox.sandboxId,
          provider: provider.name,
          result: {
            stdout: result.stdout,
            stderr: result.stderr,
            exitCode: result.exitCode,
            executionTime: result.executionTime
          }
        };
      }

      // Filesystem operations
      case 'compute.sandbox.filesystem.readFile': {
        if (!request.sandboxId) {
          return {
            success: false,
            error: 'Sandbox ID is required for filesystem operations',
            sandboxId: '',
            provider: provider.name
          };
        }

        if (!request.path) {
          return {
            success: false,
            error: 'File path is required for readFile action',
            sandboxId: request.sandboxId,
            provider: provider.name
          };
        }

        const sandbox = await getSandbox(request.sandboxId);
        const content = await sandbox.filesystem.readFile(request.path);
        
        return {
          success: true,
          sandboxId: request.sandboxId,
          provider: provider.name,
          fileContent: content
        };
      }

      case 'compute.sandbox.filesystem.writeFile': {
        if (!request.sandboxId) {
          return {
            success: false,
            error: 'Sandbox ID is required for filesystem operations',
            sandboxId: '',
            provider: provider.name
          };
        }

        if (!request.path) {
          return {
            success: false,
            error: 'File path is required for writeFile action',
            sandboxId: request.sandboxId,
            provider: provider.name
          };
        }

        if (request.content === undefined) {
          return {
            success: false,
            error: 'File content is required for writeFile action',
            sandboxId: request.sandboxId,
            provider: provider.name
          };
        }

        const sandbox = await getSandbox(request.sandboxId);
        await sandbox.filesystem.writeFile(request.path, request.content);
        
        return {
          success: true,
          sandboxId: request.sandboxId,
          provider: provider.name
        };
      }

      case 'compute.sandbox.filesystem.mkdir': {
        if (!request.sandboxId) {
          return {
            success: false,
            error: 'Sandbox ID is required for filesystem operations',
            sandboxId: '',
            provider: provider.name
          };
        }

        if (!request.path) {
          return {
            success: false,
            error: 'Directory path is required for mkdir action',
            sandboxId: request.sandboxId,
            provider: provider.name
          };
        }

        const sandbox = await getSandbox(request.sandboxId);
        await sandbox.filesystem.mkdir(request.path);
        
        return {
          success: true,
          sandboxId: request.sandboxId,
          provider: provider.name
        };
      }

      case 'compute.sandbox.filesystem.readdir': {
        if (!request.sandboxId) {
          return {
            success: false,
            error: 'Sandbox ID is required for filesystem operations',
            sandboxId: '',
            provider: provider.name
          };
        }

        if (!request.path) {
          return {
            success: false,
            error: 'Directory path is required for readdir action',
            sandboxId: request.sandboxId,
            provider: provider.name
          };
        }

        const sandbox = await getSandbox(request.sandboxId);
        const entries = await sandbox.filesystem.readdir(request.path);
        
        return {
          success: true,
          sandboxId: request.sandboxId,
          provider: provider.name,
          files: entries.map(entry => ({
            name: entry.name,
            path: entry.path,
            isDirectory: entry.isDirectory,
            size: entry.size,
            lastModified: entry.lastModified.toISOString()
          }))
        };
      }

      case 'compute.sandbox.filesystem.exists': {
        if (!request.sandboxId) {
          return {
            success: false,
            error: 'Sandbox ID is required for filesystem operations',
            sandboxId: '',
            provider: provider.name
          };
        }

        if (!request.path) {
          return {
            success: false,
            error: 'Path is required for exists action',
            sandboxId: request.sandboxId,
            provider: provider.name
          };
        }

        const sandbox = await getSandbox(request.sandboxId);
        const exists = await sandbox.filesystem.exists(request.path);
        
        return {
          success: true,
          sandboxId: request.sandboxId,
          provider: provider.name,
          exists
        };
      }

      case 'compute.sandbox.filesystem.remove': {
        if (!request.sandboxId) {
          return {
            success: false,
            error: 'Sandbox ID is required for filesystem operations',
            sandboxId: '',
            provider: provider.name
          };
        }

        if (!request.path) {
          return {
            success: false,
            error: 'Path is required for remove action',
            sandboxId: request.sandboxId,
            provider: provider.name
          };
        }

        const sandbox = await getSandbox(request.sandboxId);
        await sandbox.filesystem.remove(request.path);
        
        return {
          success: true,
          sandboxId: request.sandboxId,
          provider: provider.name
        };
      }

      // Terminal operations
      case 'compute.sandbox.terminal.create': {
        if (!request.sandboxId) {
          return {
            success: false,
            error: 'Sandbox ID is required for terminal operations',
            sandboxId: '',
            provider: provider.name
          };
        }

        const sandbox = await getSandbox(request.sandboxId);
        const terminal = await sandbox.terminal.create(request.terminalOptions);
        
        return {
          success: true,
          sandboxId: request.sandboxId,
          provider: provider.name,
          terminal: {
            pid: terminal.pid,
            command: terminal.command,
            status: terminal.status,
            cols: terminal.cols,
            rows: terminal.rows
          }
        };
      }

      case 'compute.sandbox.terminal.list': {
        if (!request.sandboxId) {
          return {
            success: false,
            error: 'Sandbox ID is required for terminal operations',
            sandboxId: '',
            provider: provider.name
          };
        }

        const sandbox = await getSandbox(request.sandboxId);
        const terminals = await sandbox.terminal.list();
        
        return {
          success: true,
          sandboxId: request.sandboxId,
          provider: provider.name,
          terminals: terminals.map(terminal => ({
            pid: terminal.pid,
            command: terminal.command,
            status: terminal.status,
            cols: terminal.cols,
            rows: terminal.rows
          }))
        };
      }

      default:
        return {
          success: false,
          error: `Unknown action: ${(request as any).action}`,
          sandboxId: request.sandboxId || '',
          provider: provider.name
        };
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error occurred',
      sandboxId: request.sandboxId || '',
      provider: provider.name
    };
  }
}