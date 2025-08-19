import type { 
  UISandbox,
  UIConsole,
  UIFilesystem,
  SandboxConfig,
  SandboxConsoleConfig,
  SandboxFilesystemConfig,
  ComputeRequest, 
  ComputeResponse,
  ConsoleEntry,
  ConsoleResult,
  Runtime
} from '../types/index.js'
import { executeComputeRequest } from '../utils/api.js'

/**
 * Configuration for createCompute factory
 */
interface ComputeConfig {
  /** API endpoint for compute operations */
  apiEndpoint?: string;
  /** Default runtime for new sandboxes */
  defaultRuntime?: Runtime;
}

/**
 * Create a sandbox instance that wraps API calls
 */
export function createSandbox(config: SandboxConfig): UISandbox {
  const { sandboxId, provider, runtime, status, apiEndpoint } = config
  
  const makeRequest = async (request: Omit<ComputeRequest, 'sandboxId'>): Promise<ComputeResponse> => {
    return executeComputeRequest({ ...request, sandboxId }, apiEndpoint)
  }

  return {
    id: sandboxId,
    provider,
    runtime,
    status,
    
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
    }
  }
}

/**
 * Create a sandbox console instance with REPL-style interaction
 */
export function createSandboxConsole(config: SandboxConsoleConfig): UIConsole {
  const { sandboxId, apiEndpoint = '/api/compute', defaultRuntime = 'python' } = config
  let history: ConsoleEntry[] = []
  let isRunning = false
  let currentRuntime = defaultRuntime
  
  const makeRequest = async (request: Omit<ComputeRequest, 'sandboxId'>): Promise<ComputeResponse> => {
    return executeComputeRequest({ ...request, sandboxId }, apiEndpoint)
  }

  const addHistoryEntry = (entry: Omit<ConsoleEntry, 'id' | 'timestamp'>): void => {
    const newEntry: ConsoleEntry = {
      ...entry,
      id: `entry-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`,
      timestamp: new Date()
    }
    history.push(newEntry)
  }

  return {
    sandboxId,
    history,
    isRunning,
    currentRuntime,

    runCode: async (code: string, runtime?: Runtime): Promise<ConsoleResult> => {
      isRunning = true
      const execRuntime = runtime || currentRuntime
      
      try {
        // Add input to history
        addHistoryEntry({
          type: 'input',
          content: code,
          runtime: execRuntime
        })

        const response = await makeRequest({
          action: 'compute.sandbox.runCode',
          code,
          runtime: execRuntime
        })

        const result: ConsoleResult = {
          success: response.success,
          stdout: response.result?.stdout || '',
          stderr: response.result?.stderr || '',
          exitCode: response.result?.exitCode || (response.success ? 0 : 1),
          executionTime: response.result?.executionTime || 0,
          error: response.error
        }

        // Add output to history
        if (result.stdout) {
          addHistoryEntry({
            type: 'output',
            content: result.stdout,
            result
          })
        }

        if (result.stderr) {
          addHistoryEntry({
            type: 'error',
            content: result.stderr,
            result
          })
        }

        return result
      } finally {
        isRunning = false
      }
    },

    runCommand: async (command: string, args?: string[]): Promise<ConsoleResult> => {
      isRunning = true
      
      try {
        const fullCommand = args ? `${command} ${args.join(' ')}` : command
        
        // Add input to history
        addHistoryEntry({
          type: 'input',
          content: fullCommand
        })

        const response = await makeRequest({
          action: 'compute.sandbox.runCommand',
          command,
          args
        })

        const result: ConsoleResult = {
          success: response.success,
          stdout: response.result?.stdout || '',
          stderr: response.result?.stderr || '',
          exitCode: response.result?.exitCode || (response.success ? 0 : 1),
          executionTime: response.result?.executionTime || 0,
          error: response.error
        }

        // Add output to history
        if (result.stdout) {
          addHistoryEntry({
            type: 'output',
            content: result.stdout,
            result
          })
        }

        if (result.stderr) {
          addHistoryEntry({
            type: 'error',
            content: result.stderr,
            result
          })
        }

        return result
      } finally {
        isRunning = false
      }
    },

    clear: (): void => {
      history = []
    },

    getContext: async (): Promise<Record<string, unknown>> => {
      // This would need to be implemented per runtime
      // For now, return empty object
      return {}
    }
  }
}

/**
 * Create a sandbox filesystem instance with enhanced UX
 */
export function createSandboxFilesystem(config: SandboxFilesystemConfig): UIFilesystem {
  const { sandboxId, apiEndpoint = '/api/compute' } = config
  const makeRequest = async (request: Omit<ComputeRequest, 'sandboxId'>): Promise<ComputeResponse> => {
    return executeComputeRequest({ ...request, sandboxId }, apiEndpoint)
  }

  return {
    sandboxId,
    
    readFile: async (path: string): Promise<string> => {
      const response = await makeRequest({
        action: 'compute.sandbox.filesystem.readFile',
        path
      })
      
      if (!response.success || response.fileContent === undefined) {
        throw new Error(response.error || 'Failed to read file')
      }
      
      return response.fileContent
    },
    
    writeFile: async (path: string, content: string): Promise<void> => {
      const response = await makeRequest({
        action: 'compute.sandbox.filesystem.writeFile',
        path,
        content
      })
      
      if (!response.success) {
        throw new Error(response.error || 'Failed to write file')
      }
    },
    
    mkdir: async (path: string): Promise<void> => {
      const response = await makeRequest({
        action: 'compute.sandbox.filesystem.mkdir',
        path
      })
      
      if (!response.success) {
        throw new Error(response.error || 'Failed to create directory')
      }
    },
    
    readdir: async (path: string): Promise<Array<{
      name: string;
      path: string;
      isDirectory: boolean;
      size: number;
      lastModified: string;
    }>> => {
      const response = await makeRequest({
        action: 'compute.sandbox.filesystem.readdir',
        path
      })
      
      if (!response.success || !response.files) {
        throw new Error(response.error || 'Failed to read directory')
      }
      
      return response.files
    },
    
    exists: async (path: string): Promise<boolean> => {
      const response = await makeRequest({
        action: 'compute.sandbox.filesystem.exists',
        path
      })
      
      if (!response.success) {
        throw new Error(response.error || 'Failed to check file existence')
      }
      
      return response.exists || false
    },
    
    remove: async (path: string): Promise<void> => {
      const response = await makeRequest({
        action: 'compute.sandbox.filesystem.remove',
        path
      })
      
      if (!response.success) {
        throw new Error(response.error || 'Failed to remove file')
      }
    }
  }
}

/**
 * Compute factory - provides access to compute environment management
 * 
 * Framework-agnostic version of the former useCompute hook
 */
export function createCompute(config: ComputeConfig = {}) {
  const apiEndpoint = config.apiEndpoint || '/api/compute'
  const defaultRuntime = config.defaultRuntime || 'python'
  
  return {
    sandbox: {
      create: async (options: { runtime?: Runtime; timeout?: number } = {}) => {
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
        
        return createSandbox({
          sandboxId: response.sandboxId, 
          provider: response.provider,
          runtime: options.runtime || defaultRuntime,
          status: 'running',
          apiEndpoint
        })
      },
      
      get: async (sandboxId: string) => {
        const response = await executeComputeRequest({
          action: 'compute.sandbox.getInfo',
          sandboxId
        }, apiEndpoint)
        
        if (!response.success) {
          return null
        }
        
        return createSandbox({
          sandboxId, 
          provider: response.provider,
          runtime: response.info?.runtime || defaultRuntime,
          status: response.info?.status || 'running',
          apiEndpoint
        })
      },
      
      list: async () => {
        const response = await executeComputeRequest({
          action: 'compute.sandbox.list'
        }, apiEndpoint)
        
        if (!response.success || !response.sandboxes) {
          return []
        }
        
        return response.sandboxes.map(sb => 
          createSandbox({
            sandboxId: sb.sandboxId, 
            provider: sb.provider, 
            runtime: defaultRuntime, 
            status: 'running', 
            apiEndpoint
          })
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