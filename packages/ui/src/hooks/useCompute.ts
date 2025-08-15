import type { 
  ComputeHook, 
  FrontendSandbox, 
  UseComputeConfig, 
  ComputeRequest, 
  ComputeResponse, 
  Runtime
} from '../types/index.js'
import { executeComputeRequest } from '../utils/api.js'

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
    }
  }
}

/**
 * useCompute hook - provides access to compute environment
 * 
 * Returns an object with sandbox management. Terminal support removed -
 * will be re-added with WebSocket VM connections.
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