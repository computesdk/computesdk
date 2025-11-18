/**
 * Railway Provider - Factory-based Implementation
 * 
 * Railway deployment provider with filesystem support using the factory pattern.
 */

import { createProvider } from 'computesdk'
import type { 
  Runtime, 
  ExecutionResult, 
  SandboxInfo,
  RunCommandOptions,
  FileEntry,
  CreateSandboxOptions
} from 'computesdk'
import { RailwayClient } from './client'
import { RailwaySandbox } from './sandbox'

export interface RailwayProviderConfig {
  apiKey: string
  projectId: string
  environmentId?: string
  baseImage?: string
  region?: string
}

export const railway = createProvider<{ id: string; status: string }, RailwayProviderConfig>({
  name: 'railway',
  methods: {
    sandbox: {
      // Collection operations (map to compute.sandbox.*)
      create: async (config: RailwayProviderConfig, options?: CreateSandboxOptions) => {
        const client = new RailwayClient(config)
        const sandbox = await RailwaySandbox.create(client, options)
        return {
          sandbox: {
            id: sandbox.sandboxId,
            status: 'running'
          },
          sandboxId: sandbox.sandboxId
        }
      },
      
      getById: async (config: RailwayProviderConfig, sandboxId: string) => {
        const client = new RailwayClient(config)
        const sandbox = await RailwaySandbox.getById(client, sandboxId)
        return {
          sandbox: {
            id: sandboxId,
            status: 'running'
          },
          sandboxId
        }
      },
      
      list: async (config: RailwayProviderConfig) => {
        const client = new RailwayClient(config)
        return await RailwaySandbox.list(client)
      },
      
      destroy: async (config: RailwayProviderConfig, sandboxId: string) => {
        const client = new RailwayClient(config)
        await RailwaySandbox.destroy(client, sandboxId)
      },
      
      // Instance operations (map to individual Sandbox methods)
      runCode: async (sandbox: any, code: string, runtime?: Runtime, config?: RailwayProviderConfig): Promise<ExecutionResult> => {
        const client = new RailwayClient(config!)
        const railwaySandbox = await RailwaySandbox.getById(client, sandbox.id)
        return await railwaySandbox.runCode(code, runtime)
      },
      
      runCommand: async (
        sandbox: any,
        command: string, 
        args?: string[], 
        options?: RunCommandOptions
      ): Promise<ExecutionResult> => {
        // We need the config passed somehow, will use a closure for now
        throw new Error('runCommand requires config access - use with provider factory')
      },
      
      getInfo: async (sandbox: any): Promise<SandboxInfo> => {
        throw new Error('getInfo requires config access - use with provider factory')
      },
      
      getUrl: async (sandbox: any, options: { port: number; protocol?: string }): Promise<string> => {
        throw new Error('getUrl requires config access - use with provider factory')
      },
      
      // Optional: Filesystem operations
      filesystem: {
        readFile: async (sandbox: any, path: string): Promise<string> => {
          throw new Error('Filesystem operations require config access - use with provider factory')
        },
        
        writeFile: async (sandbox: any, path: string, content: string): Promise<void> => {
          throw new Error('Filesystem operations require config access - use with provider factory')
        },
        
        mkdir: async (sandbox: any, path: string): Promise<void> => {
          throw new Error('Filesystem operations require config access - use with provider factory')
        },
        
        readdir: async (sandbox: any, path: string): Promise<FileEntry[]> => {
          throw new Error('Filesystem operations require config access - use with provider factory')
        },
        
        exists: async (sandbox: any, path: string): Promise<boolean> => {
          throw new Error('Filesystem operations require config access - use with provider factory')
        },
        
        remove: async (sandbox: any, path: string): Promise<void> => {
          throw new Error('Filesystem operations require config access - use with provider factory')
        }
      }
    }
  }
})

// Export types and classes
export { RailwayClient, RailwaySandbox }