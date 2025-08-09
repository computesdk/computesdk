import type { 
  ComputeHook, 
  FrontendSandbox, 
  UseComputeConfig, 
  ComputeRequest, 
  ComputeResponse, 
  Runtime,
  FrontendTerminal
} from '../types/index.js'
import { executeComputeRequest } from '../utils/api.js'

/**
 * Frontend terminal implementation that mirrors SDK terminal API
 */
class FrontendTerminalImpl implements FrontendTerminal {
  private eventSource: EventSource | null = null;
  private _onData?: (data: Uint8Array) => void;
  private _onExit?: (exitCode: number) => void;

  constructor(
    public readonly pid: number,
    public readonly command: string,
    public status: 'running' | 'exited',
    public cols: number,
    public rows: number,
    public exitCode: number | undefined,
    private sandboxId: string,
    private apiEndpoint: string,
    private makeRequest: (request: Omit<ComputeRequest, 'sandboxId'>) => Promise<ComputeResponse>
  ) {}

  /** Write data to this terminal */
  async write(data: Uint8Array | string): Promise<void> {
    const response = await this.makeRequest({
      action: 'compute.sandbox.terminal.write',
      terminalId: this.pid.toString(),
      data: typeof data === 'string' ? data : new TextDecoder().decode(data)
    });
    
    if (!response.success) {
      throw new Error(response.error || 'Failed to write to terminal');
    }
  }

  /** Resize this terminal */
  async resize(cols: number, rows: number): Promise<void> {
    const response = await this.makeRequest({
      action: 'compute.sandbox.terminal.resize',
      terminalId: this.pid.toString(),
      cols,
      rows
    });
    
    if (!response.success) {
      throw new Error(response.error || 'Failed to resize terminal');
    }
    
    // Update local state
    this.cols = cols;
    this.rows = rows;
  }

  /** Kill this terminal process */
  async kill(): Promise<void> {
    const response = await this.makeRequest({
      action: 'compute.sandbox.terminal.kill',
      terminalId: this.pid.toString()
    });
    
    if (!response.success) {
      throw new Error(response.error || 'Failed to kill terminal');
    }
    
    // Update local state
    this.status = 'exited';
  }

  /** Data stream handler - setting this automatically starts SSE streaming */
  get onData(): ((data: Uint8Array) => void) | undefined {
    return this._onData;
  }

  set onData(callback: ((data: Uint8Array) => void) | undefined) {
    this._onData = callback;
    
    if (callback) {
      this.startStreaming();
    } else {
      this.stopStreaming();
    }
  }

  /** Exit handler */
  get onExit(): ((exitCode: number) => void) | undefined {
    return this._onExit;
  }

  set onExit(callback: ((exitCode: number) => void) | undefined) {
    this._onExit = callback;
  }

  private startStreaming(): void {
    if (this.eventSource) {
      return; // Already streaming
    }

    const streamUrl = `${this.apiEndpoint}?action=terminal.stream&sandboxId=${this.sandboxId}&terminalId=${this.pid}`;
    this.eventSource = new EventSource(streamUrl);

    this.eventSource.onmessage = (event) => {
      try {
        const parsed = JSON.parse(event.data);
        
        // Handle connection messages
        if (parsed.type === 'connected') {
          return;
        }
        
        // Handle terminal data
        if (Array.isArray(parsed)) {
          const data = new Uint8Array(parsed);
          this._onData?.(data);
        }
      } catch (error) {
        console.error('Failed to parse terminal data:', error);
      }
    };

    this.eventSource.onerror = () => {
      // Auto-reconnect on error
      setTimeout(() => {
        if (this._onData && this.status === 'running') {
          this.stopStreaming();
          this.startStreaming();
        }
      }, 1000);
    };
  }

  private stopStreaming(): void {
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }
  }
}

/**
 * Create a frontend sandbox instance that wraps API calls
 */
function createFrontendSandbox(
  sandboxId: string, 
  provider: string, 
  apiEndpoint: string
): FrontendSandbox {
  
  const makeRequest = async (request: Omit<ComputeRequest, 'sandboxId'>): Promise<ComputeResponse> => {
    return executeComputeRequest({ ...request, sandboxId }, apiEndpoint)
  }

  return {
    id: sandboxId,
    provider,
    
    runCode: async (code: string, runtime?: Runtime) => {
      return makeRequest({
        action: 'compute.sandbox.runCode',
        code,
        runtime
      })
    },
    
    runCommand: async (command: string, args?: string[]) => {
      return makeRequest({
        action: 'compute.sandbox.runCommand',
        command,
        args
      })
    },
    
    getInfo: async () => {
      return makeRequest({
        action: 'compute.sandbox.getInfo'
      })
    },
    
    destroy: async () => {
      return makeRequest({
        action: 'compute.sandbox.destroy'
      })
    },
    
    filesystem: {
      readFile: async (path: string) => {
        return makeRequest({
          action: 'compute.sandbox.filesystem.readFile',
          path
        })
      },
      
      writeFile: async (path: string, content: string) => {
        return makeRequest({
          action: 'compute.sandbox.filesystem.writeFile',
          path,
          content
        })
      },
      
      mkdir: async (path: string) => {
        return makeRequest({
          action: 'compute.sandbox.filesystem.mkdir',
          path
        })
      },
      
      readdir: async (path: string) => {
        return makeRequest({
          action: 'compute.sandbox.filesystem.readdir',
          path
        })
      },
      
      exists: async (path: string) => {
        return makeRequest({
          action: 'compute.sandbox.filesystem.exists',
          path
        })
      },
      
      remove: async (path: string) => {
        return makeRequest({
          action: 'compute.sandbox.filesystem.remove',
          path
        })
      }
    },
    
    terminal: {
      create: async (options): Promise<FrontendTerminal> => {
        const response = await makeRequest({
          action: 'compute.sandbox.terminal.create',
          terminalOptions: options
        });
        
        if (!response.success || !response.terminal) {
          throw new Error(response.error || 'Failed to create terminal');
        }
        
        return new FrontendTerminalImpl(
          response.terminal.pid,
          response.terminal.command,
          response.terminal.status as 'running' | 'exited',
          response.terminal.cols,
          response.terminal.rows,
          undefined, // exitCode
          sandboxId,
          apiEndpoint,
          makeRequest
        );
      },
      
      getById: async (terminalId: string): Promise<FrontendTerminal | null> => {
        const response = await makeRequest({
          action: 'compute.sandbox.terminal.getById',
          terminalId
        });
        
        if (!response.success || !response.terminal) {
          return null;
        }
        
        return new FrontendTerminalImpl(
          response.terminal.pid,
          response.terminal.command,
          response.terminal.status as 'running' | 'exited',
          response.terminal.cols,
          response.terminal.rows,
          undefined, // exitCode
          sandboxId,
          apiEndpoint,
          makeRequest
        );
      },
      
      list: async (): Promise<FrontendTerminal[]> => {
        const response = await makeRequest({
          action: 'compute.sandbox.terminal.list'
        });
        
        if (!response.success || !response.terminals) {
          return [];
        }
        
        return response.terminals.map(terminal => 
          new FrontendTerminalImpl(
            terminal.pid,
            terminal.command,
            terminal.status as 'running' | 'exited',
            terminal.cols,
            terminal.rows,
            undefined, // exitCode
            sandboxId,
            apiEndpoint,
            makeRequest
          )
        );
      },
      
      destroy: async (terminalId: string): Promise<void> => {
        const response = await makeRequest({
          action: 'compute.sandbox.terminal.destroy',
          terminalId
        });
        
        if (!response.success) {
          throw new Error(response.error || 'Failed to destroy terminal');
        }
      }
    }
  }
}

/**
 * useCompute hook - provides access to compute environment
 * 
 * Returns an object with sandbox management and future expansion
 * for blob, database, git operations.
 */
export function useCompute(config: UseComputeConfig = {}): ComputeHook {
  const apiEndpoint = config.apiEndpoint || '/api/compute'
  const defaultRuntime = config.defaultRuntime || 'python'
  
  return {
    sandbox: {
      create: async (options = {}) => {
        const response = await executeComputeRequest({
          action: 'compute.sandbox.create',
          options: {
            runtime: options.runtime || defaultRuntime,
            timeout: options.timeout
          }
        }, apiEndpoint)
        
        if (!response.success) {
          throw new Error(response.error || 'Failed to create sandbox')
        }
        
        return createFrontendSandbox(
          response.sandboxId, 
          response.provider, 
          apiEndpoint
        )
      },
      
      get: async (sandboxId: string) => {
        const response = await executeComputeRequest({
          action: 'compute.sandbox.getInfo',
          sandboxId
        }, apiEndpoint)
        
        if (!response.success) {
          return null
        }
        
        return createFrontendSandbox(
          sandboxId, 
          response.provider, 
          apiEndpoint
        )
      },
      
      list: async () => {
        const response = await executeComputeRequest({
          action: 'compute.sandbox.list'
        }, apiEndpoint)
        
        if (!response.success || !response.sandboxes) {
          return []
        }
        
        return response.sandboxes.map(sb => 
          createFrontendSandbox(sb.sandboxId, sb.provider, apiEndpoint)
        )
      },
      
      destroy: async (sandboxId: string) => {
        const response = await executeComputeRequest({
          action: 'compute.sandbox.destroy',
          sandboxId
        }, apiEndpoint)
        
        if (!response.success) {
          throw new Error(response.error || 'Failed to destroy sandbox')
        }
      }
    }
    
    // Future expansion:
    // blob: { ... },
    // database: { ... },
    // git: { ... }
  }
}