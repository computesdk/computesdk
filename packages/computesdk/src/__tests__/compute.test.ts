import { describe, it, expect, vi, beforeEach } from 'vitest'
import { compute } from '../compute'
import { handleComputeRequest, type ComputeRequest } from '../request-handler'
import { SandboxManager } from '../sandbox'
import type { Provider, Sandbox, ExecutionResult, SandboxInfo } from '../types'

// Mock provider for testing
class MockProvider implements Provider {
  readonly name = 'mock'
  readonly sandbox = {
    async create(options?: any): Promise<Sandbox> {
      return new MockSandbox()
    },
    async getById(sandboxId: string): Promise<Sandbox | null> {
      return new MockSandbox()
    },
    async list(): Promise<Sandbox[]> {
      return [new MockSandbox()]
    },
    async destroy(sandboxId: string): Promise<void> {
      // Mock destroy
    }
  }
}

// Mock sandbox for testing
class MockSandbox implements Sandbox {
  readonly sandboxId = `mock-sandbox-${Math.random().toString(36).substr(2, 9)}`
  readonly provider = 'mock'

  async runCode(code: string): Promise<ExecutionResult> {
    return {
      stdout: `Executed: ${code}`,
      stderr: '',
      exitCode: 0,
      executionTime: 100,
      sandboxId: this.sandboxId,
      provider: this.provider
    }
  }

  async runCommand(command: string, args: string[] = []): Promise<ExecutionResult> {
    const fullCommand = args.length > 0 ? `${command} ${args.join(' ')}` : command
    return {
      stdout: `Command executed: ${fullCommand}`,
      stderr: '',
      exitCode: 0,
      executionTime: 50,
      sandboxId: this.sandboxId,
      provider: this.provider
    }
  }

  async getInfo(): Promise<SandboxInfo> {
    return {
      id: this.sandboxId,
      provider: this.provider,
      runtime: 'node',
      status: 'running',
      createdAt: new Date(),
      timeout: 30000
    }
  }

  async kill(): Promise<void> {
    // Mock implementation
  }

  async destroy(): Promise<void> {
    // Mock implementation
  }

  readonly filesystem = {
    async readFile(path: string): Promise<string> {
      return `Mock file content from ${path}`
    },
    async writeFile(path: string, content: string): Promise<void> {
      // Mock implementation
    },
    async mkdir(path: string): Promise<void> {
      // Mock implementation
    },
    async readdir(path: string): Promise<any[]> {
      return []
    },
    async exists(path: string): Promise<boolean> {
      return true
    },
    async remove(path: string): Promise<void> {
      // Mock implementation
    }
  }

  readonly terminal = {
    async create(): Promise<any> {
      return {
        pid: 123,
        command: 'bash',
        status: 'running',
        cols: 80,
        rows: 24,
        write: vi.fn(),
        resize: vi.fn(),
        kill: vi.fn()
      }
    },
    async getById(terminalId: string): Promise<any> {
      return null
    },
    async list(): Promise<any[]> {
      return []
    },
    async destroy(terminalId: string): Promise<void> {
      // Mock destroy
    }
  }
}

describe('Compute API - Provider-Centric', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
  })

  describe('SandboxManager (unit tests)', () => {
    it('should create and manage sandboxes via provider', async () => {
      const manager = new SandboxManager()
      const provider = new MockProvider()
      
      const sandbox = await manager.create(provider)
      
      expect(sandbox.provider).toBe('mock')
    })

    it('should get sandbox via provider', async () => {
      const manager = new SandboxManager()
      const provider = new MockProvider()
      
      const sandbox = await manager.getById(provider, 'test-id')
      
      expect(sandbox?.provider).toBe('mock')
    })

    it('should list sandboxes via provider', async () => {
      const manager = new SandboxManager()
      const provider = new MockProvider()
      
      const sandboxes = await manager.list(provider)
      
      expect(sandboxes).toHaveLength(1)
      expect(sandboxes[0].provider).toBe('mock')
    })

    it('should destroy sandbox via provider', async () => {
      const manager = new SandboxManager()
      const provider = new MockProvider()
      
      // Should not throw
      await expect(manager.destroy(provider, 'test-id')).resolves.toBeUndefined()
    })
  })

  describe('Provider interface (direct usage)', () => {
    it('should create sandbox via provider.sandbox.create()', async () => {
      const provider = new MockProvider()
      
      const sandbox = await provider.sandbox.create({ runtime: 'python' })
      
      expect(sandbox.sandboxId).toMatch(/^mock-sandbox-/)
      expect(sandbox.provider).toBe('mock')
    })

    it('should get sandbox via provider.sandbox.get()', async () => {
      const provider = new MockProvider()
      
      const sandbox = await provider.sandbox.getById('test-id')
      
      expect(sandbox).toBeDefined()
      expect(sandbox?.provider).toBe('mock')
    })

    it('should list sandboxes via provider.sandbox.list()', async () => {
      const provider = new MockProvider()
      
      const sandboxes = await provider.sandbox.list()
      
      expect(sandboxes).toHaveLength(1)
      expect(sandboxes[0].provider).toBe('mock')
    })

    it('should destroy sandbox via provider.sandbox.destroy()', async () => {
      const provider = new MockProvider()
      
      // Should not throw
      await expect(provider.sandbox.destroy('test-id')).resolves.toBeUndefined()
    })

    it('should have provider name property', () => {
      const provider = new MockProvider()
      
      expect(provider.name).toBe('mock')
    })
  })

  describe('compute.sandbox.create()', () => {
    it('should create a sandbox from a provider', async () => {
      const provider = new MockProvider()
      
      const sandbox = await compute.sandbox.create({ provider })
      
      expect(sandbox.sandboxId).toMatch(/^mock-sandbox-/)
      expect(sandbox.provider).toBe('mock')
    })
  })

  describe('compute.sandbox operations (provider-centric)', () => {
    it('should get sandbox via provider', async () => {
      const provider = new MockProvider()
      
      const sandbox = await compute.sandbox.getById(provider, 'test-id')
      
      expect(sandbox?.provider).toBe('mock')
    })

    it('should list sandboxes via provider', async () => {
      const provider = new MockProvider()
      
      const sandboxes = await compute.sandbox.list(provider)
      
      expect(sandboxes).toHaveLength(1)
      expect(sandboxes[0].provider).toBe('mock')
    })

    it('should destroy sandbox via provider', async () => {
      const provider = new MockProvider()
      
      // Should not throw
      await expect(compute.sandbox.destroy(provider, 'test-id')).resolves.toBeUndefined()
    })
  })

  describe('sandbox capabilities', () => {
    it('should execute code', async () => {
      const provider = new MockProvider()
      const sandbox = await compute.sandbox.create({ provider })
      
      const result = await sandbox.runCode('console.log("Hello")')
      
      expect(result.stdout).toBe('Executed: console.log("Hello")')
      expect(result.exitCode).toBe(0)
    })

    it('should run commands', async () => {
      const provider = new MockProvider()
      const sandbox = await compute.sandbox.create({ provider })
      
      const result = await sandbox.runCommand('ls', ['-la'])
      
      expect(result.stdout).toBe('Command executed: ls -la')
      expect(result.exitCode).toBe(0)
    })

    it('should have filesystem capabilities', async () => {
      const provider = new MockProvider()
      const sandbox = await compute.sandbox.create({ provider })
      
      const content = await sandbox.filesystem.readFile('/tmp/test.txt')
      
      expect(content).toBe('Mock file content from /tmp/test.txt')
    })

    it('should have terminal capabilities', async () => {
      const provider = new MockProvider()
      const sandbox = await compute.sandbox.create({ provider })
      
      const terminal = await sandbox.terminal.create()
      
      expect(terminal.pid).toBe(123)
      expect(terminal.command).toBe('bash')
    })
  })

  describe('provider-centric architecture benefits', () => {
    it('should work with multiple providers independently', async () => {
      const provider1 = new MockProvider()
      const provider2 = new MockProvider()
      
      // Each provider manages its own sandboxes
      const sandboxes1 = await compute.sandbox.list(provider1)
      const sandboxes2 = await compute.sandbox.list(provider2)
      
      expect(sandboxes1).toHaveLength(1)
      expect(sandboxes2).toHaveLength(1)
      expect(sandboxes1[0].provider).toBe('mock')
      expect(sandboxes2[0].provider).toBe('mock')
    })

    it('should support custom sandbox IDs', async () => {
      const provider = new MockProvider()
      
      const sandbox = await compute.sandbox.create({ 
        provider, 
        options: { sandboxId: 'my-custom-id' }
      })
      
      expect(sandbox.provider).toBe('mock')
      // Note: MockProvider doesn't actually use custom ID, but the interface supports it
    })
  })

  describe('Configuration System', () => {
    beforeEach(() => {
      // Clear config before each test
      compute.clearConfig()
    })

    describe('setConfig/getConfig/clearConfig', () => {
      it('should set and get configuration', () => {
        const provider = new MockProvider()
        
        compute.setConfig({ provider })
        
        const config = compute.getConfig()
        expect(config).toEqual({ provider })
        expect(config?.provider.name).toBe('mock')
      })

      it('should return null when no config is set', () => {
        const config = compute.getConfig()
        expect(config).toBeNull()
      })

      it('should clear configuration', () => {
        const provider = new MockProvider()
        
        compute.setConfig({ provider })
        expect(compute.getConfig()).not.toBeNull()
        
        compute.clearConfig()
        expect(compute.getConfig()).toBeNull()
      })

      it('should overwrite existing configuration', () => {
        const provider1 = new MockProvider()
        const provider2 = new MockProvider()
        
        compute.setConfig({ provider: provider1 })
        expect(compute.getConfig()?.provider).toBe(provider1)
        
        compute.setConfig({ provider: provider2 })
        expect(compute.getConfig()?.provider).toBe(provider2)
      })
    })

    describe('sandbox operations with default provider', () => {
      it('should create sandbox using default provider', async () => {
        const provider = new MockProvider()
        compute.setConfig({ provider })
        
        const sandbox = await compute.sandbox.create({})
        
        expect(sandbox.provider).toBe('mock')
      })

      it('should create sandbox with options using default provider', async () => {
        const provider = new MockProvider()
        compute.setConfig({ provider })
        
        const sandbox = await compute.sandbox.create({ 
          options: { runtime: 'python' }
        })
        
        expect(sandbox.provider).toBe('mock')
      })

      it('should get sandbox by ID using default provider', async () => {
        const provider = new MockProvider()
        compute.setConfig({ provider })
        
        const sandbox = await compute.sandbox.getById('test-id')
        
        expect(sandbox?.provider).toBe('mock')
      })

      it('should list sandboxes using default provider', async () => {
        const provider = new MockProvider()
        compute.setConfig({ provider })
        
        const sandboxes = await compute.sandbox.list()
        
        expect(sandboxes).toHaveLength(1)
        expect(sandboxes[0].provider).toBe('mock')
      })

      it('should destroy sandbox using default provider', async () => {
        const provider = new MockProvider()
        compute.setConfig({ provider })
        
        // Should not throw
        await expect(compute.sandbox.destroy('test-id')).resolves.toBeUndefined()
      })
    })

    describe('explicit provider overrides default', () => {
      it('should use explicit provider even when default is set', async () => {
        const defaultProvider = new MockProvider()
        const explicitProvider = new MockProvider()
        
        compute.setConfig({ provider: defaultProvider })
        
        const sandbox = await compute.sandbox.create({ provider: explicitProvider })
        
        expect(sandbox.provider).toBe('mock')
        // Both providers are MockProvider, so we can't distinguish them by name
        // But the explicit provider should be used
      })

      it('should use explicit provider for getById even when default is set', async () => {
        const defaultProvider = new MockProvider()
        const explicitProvider = new MockProvider()
        
        compute.setConfig({ provider: defaultProvider })
        
        const sandbox = await compute.sandbox.getById(explicitProvider, 'test-id')
        
        expect(sandbox?.provider).toBe('mock')
      })

      it('should use explicit provider for list even when default is set', async () => {
        const defaultProvider = new MockProvider()
        const explicitProvider = new MockProvider()
        
        compute.setConfig({ provider: defaultProvider })
        
        const sandboxes = await compute.sandbox.list(explicitProvider)
        
        expect(sandboxes).toHaveLength(1)
        expect(sandboxes[0].provider).toBe('mock')
      })

      it('should use explicit provider for destroy even when default is set', async () => {
        const defaultProvider = new MockProvider()
        const explicitProvider = new MockProvider()
        
        compute.setConfig({ provider: defaultProvider })
        
        // Should not throw
        await expect(compute.sandbox.destroy(explicitProvider, 'test-id')).resolves.toBeUndefined()
      })
    })

    describe('error handling without default provider', () => {
      it('should throw error when creating sandbox without provider or default', async () => {
        await expect(compute.sandbox.create({})).rejects.toThrow(
          'No default provider configured. Either call compute.setConfig({ provider }) or pass provider explicitly.'
        )
      })

      it('should throw error when getting sandbox without provider or default', async () => {
        await expect(compute.sandbox.getById('test-id')).rejects.toThrow(
          'No default provider configured. Either call compute.setConfig({ provider }) or pass provider explicitly.'
        )
      })

      it('should throw error when listing sandboxes without provider or default', async () => {
        await expect(compute.sandbox.list()).rejects.toThrow(
          'No default provider configured. Either call compute.setConfig({ provider }) or pass provider explicitly.'
        )
      })

      it('should throw error when destroying sandbox without provider or default', async () => {
        await expect(compute.sandbox.destroy('test-id')).rejects.toThrow(
          'No default provider configured. Either call compute.setConfig({ provider }) or pass provider explicitly.'
        )
      })
    })

    describe('parameter validation', () => {
      it('should throw error when getById called with provider but no sandboxId', async () => {
        const provider = new MockProvider()
        
        await expect(compute.sandbox.getById(provider)).rejects.toThrow(
          'sandboxId is required when provider is specified'
        )
      })

      it('should throw error when destroy called with provider but no sandboxId', async () => {
        const provider = new MockProvider()
        
        await expect(compute.sandbox.destroy(provider)).rejects.toThrow(
          'sandboxId is required when provider is specified'
        )
      })
    })

    describe('mixed usage patterns', () => {
      it('should support mixing default provider and explicit provider calls', async () => {
        const defaultProvider = new MockProvider()
        const explicitProvider = new MockProvider()
        
        compute.setConfig({ provider: defaultProvider })
        
        // Use default provider
        const sandbox1 = await compute.sandbox.create({})
        expect(sandbox1.provider).toBe('mock')
        
        // Use explicit provider
        const sandbox2 = await compute.sandbox.create({ provider: explicitProvider })
        expect(sandbox2.provider).toBe('mock')
        
        // Use default provider for list
        const sandboxes1 = await compute.sandbox.list()
        expect(sandboxes1).toHaveLength(1)
        
        // Use explicit provider for list
        const sandboxes2 = await compute.sandbox.list(explicitProvider)
        expect(sandboxes2).toHaveLength(1)
      })
    })
  })

  describe('handleComputeRequest', () => {
    it('should handle runCode action', async () => {
      const provider = new MockProvider()
      const request: ComputeRequest = {
        action: 'compute.sandbox.runCode',
        code: 'print("Hello World")',
        runtime: 'python',
        sandboxId: 'test-sandbox-id'
      }

      const response = await handleComputeRequest({ request, provider })

      expect(response.success).toBe(true)
      expect(response.provider).toBe('mock')
      expect(response.result?.stdout).toBe('Executed: print("Hello World")')
      expect(response.result?.exitCode).toBe(0)
    })

    it('should handle create action', async () => {
      const provider = new MockProvider()
      const request: ComputeRequest = {
        action: 'compute.sandbox.create',
        runtime: 'python'
      }

      const response = await handleComputeRequest({ request, provider })

      expect(response.success).toBe(true)
      expect(response.provider).toBe('mock')
      expect(response.sandboxId).toMatch(/^mock-sandbox-/)
    })

    it('should handle destroy action', async () => {
      const provider = new MockProvider()
      const request: ComputeRequest = {
        action: 'compute.sandbox.destroy',
        sandboxId: 'test-sandbox-id'
      }

      const response = await handleComputeRequest({ request, provider })

      expect(response.success).toBe(true)
      expect(response.provider).toBe('mock')
      expect(response.sandboxId).toBe('test-sandbox-id')
    })

    it('should handle getInfo action', async () => {
      const provider = new MockProvider()
      const request: ComputeRequest = {
        action: 'compute.sandbox.getInfo',
        sandboxId: 'test-sandbox-id'
      }

      const response = await handleComputeRequest({ request, provider })

      expect(response.success).toBe(true)
      expect(response.provider).toBe('mock')
      expect(response.info?.id).toMatch(/^mock-sandbox-/) // MockSandbox generates random IDs
      expect(response.info?.runtime).toBe('node')
    })

    it('should return error for execute action without code', async () => {
      const provider = new MockProvider()
      const request: ComputeRequest = {
        action: 'compute.sandbox.runCode'
      }

      const response = await handleComputeRequest({ request, provider })

      expect(response.success).toBe(false)
      expect(response.error).toBe('Code is required for runCode action')
      expect(response.provider).toBe('mock')
    })

    it('should return error for destroy action without sandboxId', async () => {
      const provider = new MockProvider()
      const request: ComputeRequest = {
        action: 'compute.sandbox.destroy'
      }

      const response = await handleComputeRequest({ request, provider })

      expect(response.success).toBe(false)
      expect(response.error).toBe('Sandbox ID is required for destroy action')
      expect(response.provider).toBe('mock')
    })

    it('should return error for getInfo action without sandboxId', async () => {
      const provider = new MockProvider()
      const request: ComputeRequest = {
        action: 'compute.sandbox.getInfo'
      }

      const response = await handleComputeRequest({ request, provider })

      expect(response.success).toBe(false)
      expect(response.error).toBe('Sandbox ID is required for getInfo action')
      expect(response.provider).toBe('mock')
    })

    it('should return error for unknown action', async () => {
      const provider = new MockProvider()
      const request = {
        action: 'unknown'
      } as any

      const response = await handleComputeRequest({ request, provider })

      expect(response.success).toBe(false)
      expect(response.error).toBe('Unknown action: unknown')
      expect(response.provider).toBe('mock')
    })
  })
})