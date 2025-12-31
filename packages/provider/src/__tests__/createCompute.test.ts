import { describe, it, expect, vi } from 'vitest'
import { createCompute } from '../compute.js'
import type { CodeResult, CommandResult, SandboxInfo } from '../types/index.js'
import type { Runtime } from 'computesdk'

const MOCK_SUPPORTED_RUNTIMES: Runtime[] = ['node', 'python']

// Mock E2B-like provider
function createMockProvider(name: string) {
  const mockSandbox = {
    sandboxId: 'test-123',
    setTimeout: vi.fn(),
    specialMethod: vi.fn().mockReturnValue(`${name}-specific`)
  }

  return {
    name,
    getSupportedRuntimes: () => MOCK_SUPPORTED_RUNTIMES,
    sandbox: {
      create: vi.fn().mockResolvedValue({
        sandboxId: 'test-123',
        provider: name,
        runCode: vi.fn().mockResolvedValue({
          output: 'Hello World',
          exitCode: 0,
          language: 'python'
        } as CodeResult),
        runCommand: vi.fn().mockResolvedValue({
          stdout: 'Command output',
          stderr: '',
          exitCode: 0,
          durationMs: 50
        } as CommandResult),
        getInfo: vi.fn().mockResolvedValue({
          id: 'test-123',
          provider: name,
          runtime: 'python' as Runtime,
          status: 'running',
          createdAt: new Date(),
          timeout: 300000,
          metadata: {}
        } as SandboxInfo),
        getUrl: vi.fn().mockResolvedValue('https://test-123-3000.mock.dev'),
        getProvider: vi.fn().mockReturnValue({ name }),
        getInstance: vi.fn().mockReturnValue(mockSandbox),
        destroy: vi.fn().mockResolvedValue(undefined),
        filesystem: {
          readFile: vi.fn(),
          writeFile: vi.fn(),
          mkdir: vi.fn(),
          readdir: vi.fn(),
          exists: vi.fn(),
          remove: vi.fn()
        }
      }),
      getById: vi.fn(),
      list: vi.fn().mockResolvedValue([]),
      destroy: vi.fn()
    }
  }
}

describe('createCompute function', () => {
  it('should create a properly typed compute instance', async () => {
    const mockProvider = createMockProvider('mock-e2b')
    
    const compute = createCompute({
      defaultProvider: mockProvider
    })

    // Should have the expected methods
    expect(typeof compute.setConfig).toBe('function')
    expect(typeof compute.getConfig).toBe('function')
    expect(typeof compute.clearConfig).toBe('function')
    expect(typeof compute.sandbox).toBe('object')
    expect(typeof compute.sandbox.create).toBe('function')
  })

  it('should create sandbox with proper typing from createCompute', async () => {
    const mockProvider = createMockProvider('mock-e2b')
    
    const compute = createCompute({
      defaultProvider: mockProvider
    })

    const sandbox = await compute.sandbox.create()

    // Should be properly typed and return the provider-specific instance
    // Note: In real usage with defineProvider<E2BSandbox>, getInstance() returns E2BSandbox
    // Here we cast to any since the mock doesn't preserve generic types
    const instance = sandbox.getInstance() as any

    expect(instance).toBeTruthy()
    expect(typeof instance.setTimeout).toBe('function')
    expect(typeof instance.specialMethod).toBe('function')

    // Should be able to call provider-specific methods
    instance.setTimeout(5000)
    expect(instance.setTimeout).toHaveBeenCalledWith(5000)

    const result = instance.specialMethod()
    expect(result).toBe('mock-e2b-specific')
  })

  it('should handle sandbox operations correctly', async () => {
    const mockProvider = createMockProvider('mock-provider')
    
    const compute = createCompute({
      defaultProvider: mockProvider
    })

    // Test create
    const sandbox = await compute.sandbox.create()
    expect(mockProvider.sandbox.create).toHaveBeenCalled()
    expect(sandbox.sandboxId).toBe('test-123')

    // Test other operations exist
    expect(typeof sandbox.runCode).toBe('function')
    expect(typeof sandbox.runCommand).toBe('function')
    expect(typeof sandbox.getInfo).toBe('function')
    expect(typeof sandbox.getUrl).toBe('function')
    expect(typeof sandbox.destroy).toBe('function')
  })

  it('should support both defaultProvider and provider keys', () => {
    const mockProvider = createMockProvider('test-provider')
    
    // Test defaultProvider
    const compute1 = createCompute({
      defaultProvider: mockProvider
    })
    expect(compute1).toBeTruthy()

    // Test legacy provider key
    const compute2 = createCompute({
      provider: mockProvider
    })
    expect(compute2).toBeTruthy()
  })

  it('should chain setConfig calls correctly', () => {
    const mockProvider1 = createMockProvider('provider1')
    const mockProvider2 = createMockProvider('provider2')
    
    const compute1 = createCompute({
      defaultProvider: mockProvider1
    })

    // setConfig should return a new typed compute instance
    const compute2 = compute1.setConfig({
      defaultProvider: mockProvider2
    })
    
    expect(compute2).toBeTruthy()
    expect(typeof compute2.sandbox.create).toBe('function')
  })

  it('should handle getConfig and clearConfig', () => {
    const mockProvider = createMockProvider('test-provider')
    
    const compute = createCompute({
      defaultProvider: mockProvider
    })

    // Should have config
    const config = compute.getConfig()
    expect(config).toBeTruthy()
    expect(config?.defaultProvider).toBe(mockProvider)

    // Should clear config (returns void)
    expect(() => compute.clearConfig()).not.toThrow()
    const clearedConfig = compute.getConfig()
    expect(clearedConfig).toBeNull()
  })
})