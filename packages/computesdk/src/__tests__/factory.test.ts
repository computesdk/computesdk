import { describe, it, expect, vi } from 'vitest'
import { createProvider } from '../factory.js'
import type { Runtime, ExecutionResult, SandboxInfo } from '../types/index.js'

describe('Factory', () => {
  describe('createProvider', () => {
    it('should create a provider factory function', () => {
      const methods = {
        create: vi.fn().mockResolvedValue({ 
          sandbox: { id: 'test-123', status: 'running' }, 
          sandboxId: 'test-123' 
        }),
        getById: vi.fn().mockResolvedValue({ 
          sandbox: { id: 'test-123', status: 'running' }, 
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
      }

      const providerFactory = createProvider({
        name: 'mock',
        methods: { sandbox: methods }
      })

      expect(typeof providerFactory).toBe('function')
      
      // Create provider instance
      const config = { apiKey: 'test-key' }
      const provider = providerFactory(config)
      
      expect(provider.name).toBe('mock')
      expect(provider.sandbox).toBeDefined()
      expect(typeof provider.sandbox.create).toBe('function')
      expect(typeof provider.sandbox.getById).toBe('function')
      expect(typeof provider.sandbox.list).toBe('function')
      expect(typeof provider.sandbox.destroy).toBe('function')
    })

    it('should create sandbox instances with core methods', async () => {
      const methods = {
        create: vi.fn().mockResolvedValue({ 
          sandbox: { id: 'test-123', status: 'running' }, 
          sandboxId: 'test-123' 
        }),
        getById: vi.fn().mockResolvedValue({ 
          sandbox: { id: 'test-123', status: 'running' }, 
          sandboxId: 'test-123' 
        }),
        list: vi.fn().mockResolvedValue([]),
        destroy: vi.fn().mockResolvedValue(undefined),
        runCode: vi.fn().mockResolvedValue({
          stdout: 'print("Hello")',
          stderr: '',
          exitCode: 0,
          executionTime: 100,
          sandboxId: 'test-123',
          provider: 'mock'
        } as ExecutionResult),
        runCommand: vi.fn().mockResolvedValue({
          stdout: 'ls output',
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
          timeout: 300000
        } as SandboxInfo),
        getUrl: vi.fn().mockResolvedValue('https://test-123-3000.mock.dev')
      }

      const providerFactory = createProvider({
        name: 'mock',
        methods: { sandbox: methods }
      })

      const config = { apiKey: 'test-key' }
      const provider = providerFactory(config)
      const sandbox = await provider.sandbox.create()

      expect(sandbox.sandboxId).toBe('test-123')
      expect(typeof sandbox.runCode).toBe('function')
      expect(typeof sandbox.runCommand).toBe('function')
      expect(typeof sandbox.getInfo).toBe('function')
      expect(typeof sandbox.destroy).toBe('function')

      // Test sandbox methods
      const codeResult = await sandbox.runCode('print("Hello")')
      expect(codeResult.stdout).toBe('print("Hello")')
      expect(codeResult.exitCode).toBe(0)

      const commandResult = await sandbox.runCommand('ls')
      expect(commandResult.stdout).toBe('ls output')
      expect(commandResult.exitCode).toBe(0)

      const info = await sandbox.getInfo()
      expect(info.id).toBe('test-123')
      expect(info.provider).toBe('mock')
    })

    it('should automatically provide default filesystem methods', async () => {
      const methods = {
        create: vi.fn().mockResolvedValue({ 
          sandbox: { id: 'test-123', status: 'running' }, 
          sandboxId: 'test-123' 
        }),
        getById: vi.fn().mockResolvedValue(null),
        list: vi.fn().mockResolvedValue([]),
        destroy: vi.fn().mockResolvedValue(undefined),
        runCode: vi.fn().mockResolvedValue({} as ExecutionResult),
        runCommand: vi.fn().mockResolvedValue({} as ExecutionResult),
        getInfo: vi.fn().mockResolvedValue({} as SandboxInfo),
        getUrl: vi.fn().mockResolvedValue('https://test-123-3000.mock.dev')
        // No filesystem methods provided
      }

      const providerFactory = createProvider({
        name: 'mock-no-fs',
        methods: { sandbox: methods }
      })

      const config = { apiKey: 'test-key' }
      const provider = providerFactory(config)
      const sandbox = await provider.sandbox.create()

      expect(sandbox.filesystem).toBeDefined()
      
      // Should automatically get default filesystem methods when none provided
      // The methods will use runCommand under the hood
      expect(sandbox.filesystem.readFile).toBeDefined()
      expect(sandbox.filesystem.writeFile).toBeDefined()
      expect(sandbox.filesystem.mkdir).toBeDefined()
      expect(sandbox.filesystem.readdir).toBeDefined()
      expect(sandbox.filesystem.exists).toBeDefined()
      expect(sandbox.filesystem.remove).toBeDefined()
    })
  })
})