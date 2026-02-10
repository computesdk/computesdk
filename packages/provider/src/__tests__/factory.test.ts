import { describe, it, expect, vi } from 'vitest'
import { defineProvider } from '../factory.js'
import type { Runtime, CodeResult, CommandResult, SandboxInfo } from '../types/index.js'

describe('Factory', () => {
  describe('defineProvider', () => {
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
          provider: 'mock',
          runtime: 'python' as Runtime,
          status: 'running',
          createdAt: new Date(),
          timeout: 300000,
          metadata: {}
        } as SandboxInfo),
        getUrl: vi.fn().mockResolvedValue('https://test-123-3000.mock.dev')
      }

      const providerFactory = defineProvider({
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
          output: 'print("Hello")',
          exitCode: 0,
          language: 'python'
        } as CodeResult),
        runCommand: vi.fn().mockResolvedValue({
          stdout: 'ls output',
          stderr: '',
          exitCode: 0,
          durationMs: 50
        } as CommandResult),
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

      const providerFactory = defineProvider({
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
      expect(codeResult.output).toContain('print("Hello")')
      expect(codeResult.exitCode).toBe(0)

      const commandResult = await sandbox.runCommand('ls')
      expect(commandResult.stdout).toBe('ls output')
      expect(commandResult.exitCode).toBe(0)

      const info = await sandbox.getInfo()
      expect(info.id).toBe('test-123')
      expect(info.provider).toBe('mock')

      // Test getUrl method
      const url = await sandbox.getUrl({ port: 3000 })
      expect(url).toBe('https://test-123-3000.mock.dev')
      expect(methods.getUrl).toHaveBeenCalledWith(
        { id: 'test-123', status: 'running' },
        { port: 3000 }
      )
    })

    it('should call getUrl with protocol option', async () => {
      const methods = {
        create: vi.fn().mockResolvedValue({
          sandbox: { id: 'test-456', status: 'running' },
          sandboxId: 'test-456'
        }),
        getById: vi.fn().mockResolvedValue(null),
        list: vi.fn().mockResolvedValue([]),
        destroy: vi.fn().mockResolvedValue(undefined),
        runCode: vi.fn().mockResolvedValue({
          output: '',
          exitCode: 0,
          language: 'python'
        } as CodeResult),
        runCommand: vi.fn().mockResolvedValue({
          stdout: '',
          stderr: '',
          exitCode: 0,
          durationMs: 50
        } as CommandResult),
        getInfo: vi.fn().mockResolvedValue({
          id: 'test-456',
          provider: 'mock',
          runtime: 'python' as Runtime,
          status: 'running',
          createdAt: new Date(),
          timeout: 300000
        } as SandboxInfo),
        getUrl: vi.fn().mockResolvedValue('wss://test-456-8080.mock.dev')
      }

      const providerFactory = defineProvider({
        name: 'mock',
        methods: { sandbox: methods }
      })

      const provider = providerFactory({ apiKey: 'test-key' })
      const sandbox = await provider.sandbox.create()

      const url = await sandbox.getUrl({ port: 8080, protocol: 'wss' })
      expect(url).toBe('wss://test-456-8080.mock.dev')
      expect(methods.getUrl).toHaveBeenCalledWith(
        { id: 'test-456', status: 'running' },
        { port: 8080, protocol: 'wss' }
      )
    })
  })
})