import { describe, it, expect, vi } from 'vitest'
import { createProvider } from '../factory.js'
import type { Runtime, ExecutionResult, SandboxInfo } from '../types/index.js'

// Mock E2B-like sandbox type
interface MockE2BSandbox {
  sandboxId: string
  setTimeout(ms: number): void
  specialE2BMethod(): string
}

describe('getInstance method', () => {
  it('should return provider-specific typed instance when getInstance method provided', async () => {
    const mockE2BSandbox: MockE2BSandbox = {
      sandboxId: 'test-123',
      setTimeout: vi.fn(),
      specialE2BMethod: vi.fn().mockReturnValue('e2b-specific')
    }

    const methods = {
      create: vi.fn().mockResolvedValue({ 
        sandbox: mockE2BSandbox, 
        sandboxId: 'test-123' 
      }),
      getById: vi.fn().mockResolvedValue({ 
        sandbox: mockE2BSandbox, 
        sandboxId: 'test-123' 
      }),
      list: vi.fn().mockResolvedValue([]),
      destroy: vi.fn().mockResolvedValue(undefined),
      runCode: vi.fn().mockResolvedValue({
        stdout: 'Hello World',
        stderr: '',
        exitCode: 0,
        executionTime: 100,
        sandboxId: 'test-123',
        provider: 'mock'
      } as ExecutionResult),
      runCommand: vi.fn().mockResolvedValue({
        stdout: 'Command output',
        stderr: '',
        exitCode: 0,
        executionTime: 50,
        sandboxId: 'test-123',
        provider: 'mock'
      } as ExecutionResult),
      getInfo: vi.fn().mockResolvedValue({
        id: 'test-123',
        provider: 'mock',
        runtime: 'python' as Runtime,
        status: 'running',
        createdAt: new Date(),
        timeout: 300000,
        metadata: {}
      } as SandboxInfo),
      getUrl: vi.fn().mockResolvedValue('https://test-123-3000.mock.dev'),
      
      // Provider-specific getInstance method that returns typed instance
      getInstance: (sandbox: MockE2BSandbox): MockE2BSandbox => {
        return sandbox
      }
    }

    const providerFactory = createProvider({
      name: 'mock-e2b',
      methods: { sandbox: methods }
    })

    const config = { apiKey: 'test-key' }
    const provider = providerFactory(config)
    const sandbox = await provider.sandbox.create()

    // Test getInstance() method
    const instance = sandbox.getInstance()
    
    // Should be able to access provider-specific methods
    expect(instance).toBe(mockE2BSandbox)
    expect(instance.sandboxId).toBe('test-123')
    
    // Should be able to call provider-specific methods without type casting
    instance.setTimeout(5000)
    expect(instance.setTimeout).toHaveBeenCalledWith(5000)
    
    const result = instance.specialE2BMethod()
    expect(result).toBe('e2b-specific')
    expect(instance.specialE2BMethod).toHaveBeenCalled()
  })

  it('should return generic instance when no getInstance method provided', async () => {
    const mockGenericSandbox = {
      id: 'test-123',
      status: 'running'
    }

    const methods = {
      create: vi.fn().mockResolvedValue({ 
        sandbox: mockGenericSandbox, 
        sandboxId: 'test-123' 
      }),
      getById: vi.fn().mockResolvedValue({ 
        sandbox: mockGenericSandbox, 
        sandboxId: 'test-123' 
      }),
      list: vi.fn().mockResolvedValue([]),
      destroy: vi.fn().mockResolvedValue(undefined),
      runCode: vi.fn().mockResolvedValue({
        stdout: 'Hello World',
        stderr: '',
        exitCode: 0,
        executionTime: 100,
        sandboxId: 'test-123',
        provider: 'mock'
      } as ExecutionResult),
      runCommand: vi.fn().mockResolvedValue({
        stdout: 'Command output',
        stderr: '',
        exitCode: 0,
        executionTime: 50,
        sandboxId: 'test-123',
        provider: 'mock'
      } as ExecutionResult),
      getInfo: vi.fn().mockResolvedValue({
        id: 'test-123',
        provider: 'mock',
        runtime: 'python' as Runtime,
        status: 'running',
        createdAt: new Date(),
        timeout: 300000,
        metadata: {}
      } as SandboxInfo),
      getUrl: vi.fn().mockResolvedValue('https://test-123-3000.mock.dev')
      // No getInstance method provided
    }

    const providerFactory = createProvider({
      name: 'mock-generic',
      methods: { sandbox: methods }
    })

    const config = { apiKey: 'test-key' }
    const provider = providerFactory(config)
    const sandbox = await provider.sandbox.create()

    // Test getInstance() method - should return the generic sandbox
    const instance = sandbox.getInstance()
    
    expect(instance).toBe(mockGenericSandbox)
    expect(instance.id).toBe('test-123')
    expect(instance.status).toBe('running')
  })

  it('should return typed instance through provider type inference', async () => {
    interface CustomSandbox {
      customProperty: string
    }

    const mockSandbox: CustomSandbox = {
      customProperty: 'custom-value'
    }

    const methods = {
      create: vi.fn().mockResolvedValue({ 
        sandbox: mockSandbox, 
        sandboxId: 'test-123' 
      }),
      getById: vi.fn().mockResolvedValue({ 
        sandbox: mockSandbox, 
        sandboxId: 'test-123' 
      }),
      list: vi.fn().mockResolvedValue([]),
      destroy: vi.fn().mockResolvedValue(undefined),
      runCode: vi.fn().mockResolvedValue({} as ExecutionResult),
      runCommand: vi.fn().mockResolvedValue({} as ExecutionResult),
      getInfo: vi.fn().mockResolvedValue({} as SandboxInfo),
      getUrl: vi.fn().mockResolvedValue('https://test-123-3000.mock.dev'),
      
      // Custom getInstance that returns proper type
      getInstance: (sandbox: CustomSandbox): CustomSandbox => {
        return sandbox
      }
    }

    const providerFactory = createProvider<CustomSandbox, { apiKey: string }>({
      name: 'mock-custom',
      methods: { sandbox: methods }
    })

    const config = { apiKey: 'test-key' }
    const provider = providerFactory(config)
    const sandbox = await provider.sandbox.create()

    // Test getInstance() returns properly typed instance
    const instance = sandbox.getInstance()
    
    expect(instance.customProperty).toBe('custom-value')
  })
})