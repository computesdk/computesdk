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
 * Terminal callback manager for handling multiple SSE connections
 */
class TerminalCallbackManager {
  private static instance: TerminalCallbackManager;
  private callbacks = new Map<string, Map<string, (data: Uint8Array) => void>>();
  private terminals = new Map<string, any>();

  static getInstance(): TerminalCallbackManager {
    if (!TerminalCallbackManager.instance) {
      TerminalCallbackManager.instance = new TerminalCallbackManager();
    }
    return TerminalCallbackManager.instance;
  }

  /**
   * Add a callback for a terminal
   */
  addCallback(terminalId: string, connectionId: string, callback: (data: Uint8Array) => void, terminal: any): void {
    // Initialize terminal callbacks if not exists
    if (!this.callbacks.has(terminalId)) {
      this.callbacks.set(terminalId, new Map());
      this.terminals.set(terminalId, terminal);
      
      // Set up the master onData callback that broadcasts to all connections
      terminal.onData = (data: Uint8Array) => {
        const terminalCallbacks = this.callbacks.get(terminalId);
        if (terminalCallbacks) {
          terminalCallbacks.forEach(cb => {
            try {
              cb(data);
            } catch (error) {
              // Ignore errors from individual callbacks
              console.warn('Terminal callback error:', error);
            }
          });
        }
      };
    }

    // Add this connection's callback
    this.callbacks.get(terminalId)!.set(connectionId, callback);
  }

  /**
   * Remove a callback for a terminal
   */
  removeCallback(terminalId: string, connectionId: string): void {
    const terminalCallbacks = this.callbacks.get(terminalId);
    if (terminalCallbacks) {
      terminalCallbacks.delete(connectionId);
      
      // If no more callbacks, clean up the terminal's onData
      if (terminalCallbacks.size === 0) {
        const terminal = this.terminals.get(terminalId);
        if (terminal) {
          terminal.onData = undefined;
        }
        this.callbacks.delete(terminalId);
        this.terminals.delete(terminalId);
      }
    }
  }

  /**
   * Get number of active connections for a terminal
   */
  getConnectionCount(terminalId: string): number {
    return this.callbacks.get(terminalId)?.size || 0;
  }
}

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
    | 'compute.sandbox.terminal.getById'
    | 'compute.sandbox.terminal.list'
    | 'compute.sandbox.terminal.destroy'
    // Terminal I/O operations
    | 'compute.sandbox.terminal.write'
    | 'compute.sandbox.terminal.resize'
    | 'compute.sandbox.terminal.kill';

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

  /** Terminal ID (for terminal operations) */
  terminalId?: string;

  /** Terminal input data (for terminal.write) */
  data?: string | Uint8Array;

  /** Terminal resize dimensions (for terminal.resize) */
  cols?: number;
  rows?: number;
  
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

  /** WebSocket connection info (for terminal.connect action) */
  websocket?: {
    url: string;
    headers?: Record<string, string>;
    protocols?: string[];
  };
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
 * Parameters for handleHttpComputeRequest
 */
export interface HandleHttpComputeRequestParams {
  /** The HTTP request to handle */
  request: Request;
  /** Provider to use for the operation */
  provider: Provider;
}

/**
 * Handle HTTP compute requests with automatic SSE detection
 * 
 * This is the main entry point for web frameworks. It automatically detects
 * different request types and routes them appropriately:
 * - GET with action=terminal.stream: Returns SSE stream for terminal output
 * - POST: Regular compute operations (including terminal I/O)
 * 
 * @example
 * ```typescript
 * // Framework implementation (works for Next.js, Nuxt, SvelteKit, etc.)
 * export async function GET(request: Request) {
 *   return handleHttpComputeRequest({
 *     request,
 *     provider: e2b({ apiKey: process.env.E2B_API_KEY })
 *   });
 * }
 * 
 * export async function POST(request: Request) {
 *   return handleHttpComputeRequest({
 *     request,
 *     provider: e2b({ apiKey: process.env.E2B_API_KEY })
 *   });
 * }
 * 
 * // Client usage
 * // 1. Create terminal (HTTP POST)
 * fetch('/api/compute', {
 *   method: 'POST',
 *   body: JSON.stringify({ action: 'compute.sandbox.terminal.create', sandboxId: '123' })
 * });
 * 
 * // 2. Stream terminal output (EventSource GET)
 * const eventSource = new EventSource('/api/compute?action=terminal.stream&terminalId=456');
 * eventSource.onmessage = (event) => xtermInstance.write(JSON.parse(event.data));
 * 
 * // 3. Send terminal input (HTTP POST)
 * fetch('/api/compute', {
 *   method: 'POST',
 *   body: JSON.stringify({ action: 'compute.sandbox.terminal.write', terminalId: '456', data: 'ls -la\n' })
 * });
 * ```
 */
export async function handleHttpComputeRequest(params: HandleHttpComputeRequestParams): Promise<Response> {
  const { request, provider } = params;
  
  // Handle GET requests (SSE streaming)
  if (request.method === 'GET') {
    const url = new URL(request.url);
    const action = url.searchParams.get('action');
    
    if (action === 'terminal.stream') {
      return handleTerminalStream(request, provider);
    }
    
    // Other GET requests not supported
    return Response.json({
      success: false,
      error: 'GET requests only supported for terminal.stream action',
      sandboxId: '',
      provider: provider.name
    }, { status: 400 });
  }
  
  // Handle POST requests (regular compute operations)
  try {
    const body = await request.json();
    const computeRequest = body as ComputeRequest;
    
    // Use existing handleComputeRequest function
    const response = await handleComputeRequest({
      request: computeRequest,
      provider
    });
    
    return Response.json(response);
    
  } catch (error) {
    return Response.json({
      success: false,
      error: error instanceof Error ? error.message : 'Invalid request format',
      sandboxId: '',
      provider: provider.name
    }, { status: 400 });
  }
}

/**
 * Handle terminal SSE streaming
 */
async function handleTerminalStream(request: Request, provider: Provider): Promise<Response> {
  const url = new URL(request.url);
  const sandboxId = url.searchParams.get('sandboxId');
  const terminalId = url.searchParams.get('terminalId');
  
  if (!sandboxId || !terminalId) {
    return Response.json({
      success: false,
      error: 'sandboxId and terminalId are required for terminal streaming',
      sandboxId: sandboxId || '',
      provider: provider.name
    }, { status: 400 });
  }
  
  try {
    // Get the sandbox and terminal
    const sandbox = await compute.sandbox.getById(provider, sandboxId);
    if (!sandbox) {
      return Response.json({
        success: false,
        error: `Sandbox with ID ${sandboxId} not found`,
        sandboxId,
        provider: provider.name
      }, { status: 404 });
    }
    
    const terminal = await sandbox.terminal.getById(terminalId);
    if (!terminal) {
      return Response.json({
        success: false,
        error: `Terminal with ID ${terminalId} not found`,
        sandboxId,
        provider: provider.name
      }, { status: 404 });
    }
    
    // Generate unique connection ID
    const connectionId = `${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
    const callbackManager = TerminalCallbackManager.getInstance();
    
    // Create SSE stream
    const stream = new ReadableStream({
      start(controller) {
        // Set up callback for this connection
        const callback = (data: Uint8Array) => {
          const dataArray = Array.from(data);
          const sseData = `data: ${JSON.stringify(dataArray)}\n\n`;
          controller.enqueue(new TextEncoder().encode(sseData));
        };
        
        // Register callback with manager
        callbackManager.addCallback(terminalId, connectionId, callback, terminal);
        
        // Send initial connection message
        const connectMsg = `data: ${JSON.stringify({ 
          type: 'connected', 
          terminalId, 
          connectionId,
          activeConnections: callbackManager.getConnectionCount(terminalId)
        })}\n\n`;
        controller.enqueue(new TextEncoder().encode(connectMsg));
      },
      
      cancel() {
        // Clean up this connection's callback
        callbackManager.removeCallback(terminalId, connectionId);
      }
    });
    
    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Cache-Control'
      }
    });
    
  } catch (error) {
    return Response.json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to create terminal stream',
      sandboxId,
      provider: provider.name
    }, { status: 500 });
  }
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

      case 'compute.sandbox.terminal.getById': {
        if (!request.sandboxId) {
          return {
            success: false,
            error: 'Sandbox ID is required for terminal operations',
            sandboxId: '',
            provider: provider.name
          };
        }

        if (!request.terminalId) {
          return {
            success: false,
            error: 'Terminal ID is required for getById action',
            sandboxId: request.sandboxId,
            provider: provider.name
          };
        }

        const sandbox = await getSandbox(request.sandboxId);
        const terminal = await sandbox.terminal.getById(request.terminalId);
        
        if (!terminal) {
          return {
            success: false,
            error: `Terminal with ID ${request.terminalId} not found`,
            sandboxId: request.sandboxId,
            provider: provider.name
          };
        }
        
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

      case 'compute.sandbox.terminal.destroy': {
        if (!request.sandboxId) {
          return {
            success: false,
            error: 'Sandbox ID is required for terminal operations',
            sandboxId: '',
            provider: provider.name
          };
        }

        if (!request.terminalId) {
          return {
            success: false,
            error: 'Terminal ID is required for destroy action',
            sandboxId: request.sandboxId,
            provider: provider.name
          };
        }

        const sandbox = await getSandbox(request.sandboxId);
        await sandbox.terminal.destroy(request.terminalId);
        
        return {
          success: true,
          sandboxId: request.sandboxId,
          provider: provider.name
        };
      }

      // Terminal I/O operations
      case 'compute.sandbox.terminal.write': {
        if (!request.sandboxId) {
          return {
            success: false,
            error: 'Sandbox ID is required for terminal operations',
            sandboxId: '',
            provider: provider.name
          };
        }

        if (!request.terminalId) {
          return {
            success: false,
            error: 'Terminal ID is required for write action',
            sandboxId: request.sandboxId,
            provider: provider.name
          };
        }

        if (!request.data) {
          return {
            success: false,
            error: 'Data is required for write action',
            sandboxId: request.sandboxId,
            provider: provider.name
          };
        }

        const sandbox = await getSandbox(request.sandboxId);
        const terminal = await sandbox.terminal.getById(request.terminalId);
        
        if (!terminal) {
          return {
            success: false,
            error: `Terminal with ID ${request.terminalId} not found`,
            sandboxId: request.sandboxId,
            provider: provider.name
          };
        }

        await terminal.write(request.data);
        
        return {
          success: true,
          sandboxId: request.sandboxId,
          provider: provider.name
        };
      }

      case 'compute.sandbox.terminal.resize': {
        if (!request.sandboxId) {
          return {
            success: false,
            error: 'Sandbox ID is required for terminal operations',
            sandboxId: '',
            provider: provider.name
          };
        }

        if (!request.terminalId) {
          return {
            success: false,
            error: 'Terminal ID is required for resize action',
            sandboxId: request.sandboxId,
            provider: provider.name
          };
        }

        if (!request.cols || !request.rows) {
          return {
            success: false,
            error: 'Cols and rows are required for resize action',
            sandboxId: request.sandboxId,
            provider: provider.name
          };
        }

        const sandbox = await getSandbox(request.sandboxId);
        const terminal = await sandbox.terminal.getById(request.terminalId);
        
        if (!terminal) {
          return {
            success: false,
            error: `Terminal with ID ${request.terminalId} not found`,
            sandboxId: request.sandboxId,
            provider: provider.name
          };
        }

        await terminal.resize(request.cols, request.rows);
        
        return {
          success: true,
          sandboxId: request.sandboxId,
          provider: provider.name
        };
      }

      case 'compute.sandbox.terminal.kill': {
        if (!request.sandboxId) {
          return {
            success: false,
            error: 'Sandbox ID is required for terminal operations',
            sandboxId: '',
            provider: provider.name
          };
        }

        if (!request.terminalId) {
          return {
            success: false,
            error: 'Terminal ID is required for kill action',
            sandboxId: request.sandboxId,
            provider: provider.name
          };
        }

        const sandbox = await getSandbox(request.sandboxId);
        const terminal = await sandbox.terminal.getById(request.terminalId);
        
        if (!terminal) {
          return {
            success: false,
            error: `Terminal with ID ${request.terminalId} not found`,
            sandboxId: request.sandboxId,
            provider: provider.name
          };
        }

        await terminal.kill();
        
        return {
          success: true,
          sandboxId: request.sandboxId,
          provider: provider.name
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

/**
 * Handle WebSocket upgrade requests for real-time terminal I/O
 * 
 * TODO: Implement WebSocket terminal connections
 * 
 * This function should:
 * 1. Parse WebSocket upgrade request (sandboxId, terminalId from URL/headers)
 * 2. Validate the terminal session exists
 * 3. Upgrade HTTP connection to WebSocket
 * 4. Establish bidirectional proxy to provider's WebSocket
 * 5. Handle connection lifecycle (connect, disconnect, error)
 * 
 * @example
 * ```typescript
 * // Framework usage (Next.js)
 * export async function GET(request: Request) {
 *   if (request.headers.get('upgrade') === 'websocket') {
 *     return handleComputeWebSocket(request, { provider })
 *   }
 *   return handleComputeRequest({ request, provider })
 * }
 * 
 * // Frontend usage
 * const ws = new WebSocket('/api/compute?action=terminal.connect&sandboxId=123&terminalId=456')
 * ws.onmessage = (event) => console.log(event.data)
 * ws.send('ls -la\n')
 * ```
 * 
 * @param request - WebSocket upgrade request
 * @param params - Handler parameters (provider, etc.)
 * @returns WebSocket upgrade response
 */
export async function handleComputeWebSocket(
  _request: Request,
  _params: HandleComputeRequestParams
): Promise<Response> {
  // TODO: Implement WebSocket terminal connections
  // This is a placeholder for future implementation
  
  return new Response('WebSocket terminal connections not yet implemented', {
    status: 501,
    statusText: 'Not Implemented'
  });
}