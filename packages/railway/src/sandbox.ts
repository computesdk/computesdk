import type { 
  Runtime, 
  ExecutionResult, 
  SandboxInfo,
  RunCommandOptions,
  FileEntry,
  CreateSandboxOptions
} from 'computesdk'
import { RailwayClient } from './client'
// @ts-ignore
import fetch from 'node-fetch'

export class RailwaySandbox {
  private client: RailwayClient
  private serviceId: string
  private deploymentUrl: string
  private _isDestroyed: boolean = false
  private startTime: Date
  
  constructor(client: RailwayClient, serviceId: string, deploymentUrl: string) {
    this.client = client
    this.serviceId = serviceId
    this.deploymentUrl = deploymentUrl
    this.startTime = new Date()
  }
  
  get sandboxId(): string {
    return this.serviceId
  }
  
  get isDestroyed(): boolean {
    return this._isDestroyed
  }
  
  static async create(
    client: RailwayClient, 
    options: CreateSandboxOptions = {}
  ): Promise<RailwaySandbox> {
    // Generate unique sandbox name
    const sandboxName = `sandbox-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
    
    // Prepare environment variables
    const env: Record<string, string> = {
      SANDBOX_MODE: 'true',
      RUNTIME: options.runtime || 'node',
      TIMEOUT: (options.timeout || 300000).toString(),
      ...options.envs
    }
    
    // Add metadata as env vars
    if (options.metadata) {
      Object.entries(options.metadata).forEach(([key, value]) => {
        env[`METADATA_${key.toUpperCase()}`] = String(value)
      })
    }
    
    // Create Railway service
    const service = await client.createService(sandboxName, env)
    
    // Deploy the service
    await client.deployService(service.id)
    
    // Wait for deployment to be ready
    const deploymentUrl = await this.waitForDeployment(client, service.id)
    
    // Wait for sandbox server to be ready
    await this.waitForSandboxReady(deploymentUrl)
    
    return new RailwaySandbox(client, service.id, deploymentUrl)
  }
  
  static async getById(client: RailwayClient, sandboxId: string): Promise<RailwaySandbox> {
    const service = await client.getService(sandboxId)
    
    const instance = service.serviceInstances.edges[0]?.node
    const deployment = instance?.latestDeployment
    
    if (!deployment || !deployment.staticUrl) {
      throw new Error(`Sandbox ${sandboxId} not found or not deployed`)
    }
    
    return new RailwaySandbox(client, sandboxId, deployment.staticUrl)
  }
  
  static async list(client: RailwayClient): Promise<any[]> {
    const services = await client.listServices()
    
    // Filter for sandbox services only
    return services
      .filter(service => service.name.startsWith('sandbox-'))
      .map(service => ({
        id: service.id,
        name: service.name,
        status: service.serviceInstances.edges[0]?.node?.latestDeployment?.status || 'unknown'
      }))
  }
  
  static async destroy(client: RailwayClient, sandboxId: string): Promise<void> {
    await client.deleteService(sandboxId)
  }
  
  async runCode(code: string, runtime?: Runtime): Promise<ExecutionResult> {
    if (this._isDestroyed) {
      throw new Error('Cannot execute code on destroyed sandbox')
    }
    
    const startTime = Date.now()
    
    try {
      const response = await fetch(`${this.deploymentUrl}/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code,
          runtime: runtime || 'node'
        })
      })
      
      if (!response.ok) {
        throw new Error(`Execution failed: ${response.statusText}`)
      }
      
      const result = await response.json() as any
      const executionTime = Date.now() - startTime
      
      return {
        stdout: result.stdout || '',
        stderr: result.stderr || '',
        exitCode: result.exitCode || 0,
        executionTime,
        sandboxId: this.serviceId,
        provider: 'railway'
      }
    } catch (error: any) {
      return {
        stdout: '',
        stderr: error.message,
        exitCode: 1,
        executionTime: Date.now() - startTime,
        sandboxId: this.serviceId,
        provider: 'railway'
      }
    }
  }
  
  async runCommand(
    command: string, 
    args: string[] = [], 
    options: RunCommandOptions = {}
  ): Promise<ExecutionResult> {
    if (this._isDestroyed) {
      throw new Error('Cannot run command on destroyed sandbox')
    }
    
    const startTime = Date.now()
    
    try {
      const response = await fetch(`${this.deploymentUrl}/command`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          command,
          args,
          cwd: '/workspace',
          env: {},
          background: options.background || false
        })
      })
      
      if (!response.ok) {
        throw new Error(`Command failed: ${response.statusText}`)
      }
      
      const result = await response.json() as any
      const executionTime = Date.now() - startTime
      
      return {
        stdout: result.stdout || '',
        stderr: result.stderr || '',
        exitCode: result.exitCode || 0,
        executionTime,
        sandboxId: this.serviceId,
        provider: 'railway',
        isBackground: options.background,
        pid: result.pid
      }
    } catch (error: any) {
      return {
        stdout: '',
        stderr: error.message,
        exitCode: 1,
        executionTime: Date.now() - startTime,
        sandboxId: this.serviceId,
        provider: 'railway'
      }
    }
  }
  
  async getInfo(): Promise<SandboxInfo> {
    const service = await this.client.getService(this.serviceId)
    const deployment = service.serviceInstances.edges[0]?.node?.latestDeployment
    
    return {
      id: this.serviceId,
      provider: 'railway',
      runtime: 'node', // Could extract from env vars
      status: deployment?.status === 'SUCCESS' ? 'running' : 'stopped',
      createdAt: this.startTime,
      timeout: 300000,
      metadata: {
        deploymentUrl: this.deploymentUrl,
        railwayServiceId: this.serviceId
      }
    }
  }
  
  async getUrl(options: { port: number; protocol?: string }): Promise<string> {
    const protocol = options.protocol || 'https'
    // Railway typically exposes services on their static URLs
    // The port mapping is handled internally
    return `${protocol}://${this.deploymentUrl.replace('https://', '')}`
  }
  
  get filesystem() {
    return {
      readFile: async (path: string): Promise<string> => {
        if (this._isDestroyed) {
          throw new Error('Cannot access filesystem on destroyed sandbox')
        }
        
        const response = await fetch(`${this.deploymentUrl}/fs/read`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path })
        })
        
        if (!response.ok) {
          throw new Error(`Failed to read file: ${response.statusText}`)
        }
        
        const result = await response.json() as any
        return result.content
      },
      
      writeFile: async (path: string, content: string): Promise<void> => {
        if (this._isDestroyed) {
          throw new Error('Cannot access filesystem on destroyed sandbox')
        }
        
        const response = await fetch(`${this.deploymentUrl}/fs/write`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path, content })
        })
        
        if (!response.ok) {
          throw new Error(`Failed to write file: ${response.statusText}`)
        }
      },
      
      mkdir: async (path: string): Promise<void> => {
        if (this._isDestroyed) {
          throw new Error('Cannot access filesystem on destroyed sandbox')
        }
        
        const response = await fetch(`${this.deploymentUrl}/fs/mkdir`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path })
        })
        
        if (!response.ok) {
          throw new Error(`Failed to create directory: ${response.statusText}`)
        }
      },
      
      readdir: async (path: string): Promise<FileEntry[]> => {
        if (this._isDestroyed) {
          throw new Error('Cannot access filesystem on destroyed sandbox')
        }
        
        const response = await fetch(`${this.deploymentUrl}/fs/readdir`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path })
        })
        
        if (!response.ok) {
          throw new Error(`Failed to read directory: ${response.statusText}`)
        }
        
        const result = await response.json() as any
        return result.files.map((file: any) => ({
          name: file.name,
          path: file.path,
          isDirectory: file.isDirectory,
          size: file.size || 0,
          lastModified: file.lastModified ? new Date(file.lastModified) : undefined
        }))
      },
      
      exists: async (path: string): Promise<boolean> => {
        if (this._isDestroyed) {
          return false
        }
        
        const response = await fetch(`${this.deploymentUrl}/fs/exists`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path })
        })
        
        if (!response.ok) {
          return false
        }
        
        const result = await response.json() as any
        return result.exists
      },
      
      remove: async (path: string): Promise<void> => {
        if (this._isDestroyed) {
          throw new Error('Cannot access filesystem on destroyed sandbox')
        }
        
        const response = await fetch(`${this.deploymentUrl}/fs/remove`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path })
        })
        
        if (!response.ok) {
          throw new Error(`Failed to remove file/directory: ${response.statusText}`)
        }
      }
    }
  }
  
  async destroy(): Promise<void> {
    if (this._isDestroyed) {
      return
    }
    
    await RailwaySandbox.destroy(this.client, this.serviceId)
    this._isDestroyed = true
  }
  
  private static async waitForDeployment(
    client: RailwayClient, 
    serviceId: string, 
    timeout = 180000
  ): Promise<string> {
    const startTime = Date.now()
    
    while (Date.now() - startTime < timeout) {
      const service = await client.getService(serviceId)
      const instance = service.serviceInstances.edges[0]?.node
      const deployment = instance?.latestDeployment
      
      if (deployment?.status === 'SUCCESS' && deployment?.staticUrl) {
        return deployment.staticUrl
      }
      
      if (deployment?.status === 'FAILED' || deployment?.status === 'CRASHED') {
        throw new Error('Deployment failed')
      }
      
      await new Promise(resolve => setTimeout(resolve, 5000))
    }
    
    throw new Error('Deployment timeout')
  }
  
  private static async waitForSandboxReady(
    url: string, 
    timeout = 60000
  ): Promise<void> {
    const startTime = Date.now()
    
    while (Date.now() - startTime < timeout) {
      try {
        const response = await fetch(`${url}/health`, { 
          method: 'GET',
          signal: AbortSignal.timeout(5000)
        })
        
        if (response.ok) {
          return
        }
      } catch (error) {
        // Continue waiting
      }
      
      await new Promise(resolve => setTimeout(resolve, 3000))
    }
    
    throw new Error('Sandbox server failed to become ready')
  }
}