import { describe, it, expect, vi, beforeEach } from 'vitest'
import { E2BProvider, e2b } from '../index'
import { ConfigurationError } from 'computesdk'

// Mock the E2B SDK
vi.mock('@e2b/code-interpreter', () => ({
  Sandbox: {
    create: vi.fn()
  }
}))

// Create a more complete mock that matches the E2B Sandbox interface
const createMockSandbox = () => ({
  id: 'e2b-session-123',
  sandboxId: 'e2b-session-123',
  runCode: vi.fn(),
  kill: vi.fn(),
  close: vi.fn(),
  files: {},
  commands: {},
  pty: {},
  isRunning: true,
  template: 'base',
  metadata: {},
  envVars: {},
  cwd: '/code',
  onStdout: vi.fn(),
  onStderr: vi.fn(),
  onExit: vi.fn(),
  filesystem: {},
  process: {}
})

describe('E2BProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.unstubAllEnvs()
    vi.stubEnv('E2B_API_KEY', 'e2b_test_1234567890abcdef1234567890abcdef12345678')
  })

  describe('constructor', () => {
    it('should create provider with default config', () => {
      const provider = new E2BProvider({})
      
      expect(provider.provider).toBe('e2b')
      expect(provider.sandboxId).toMatch(/^e2b-\d+-[a-z0-9]+$/)
    })

    it('should throw error without API key', () => {
      vi.unstubAllEnvs()
      
      expect(() => new E2BProvider({})).toThrow(
        'Missing E2B API key. Set E2B_API_KEY environment variable.'
      )
    })

    it('should accept different runtimes', () => {
      const provider = new E2BProvider({ runtime: 'node' })
      expect(provider).toBeDefined()
    })

    it('should accept python runtime', () => {
      const provider = new E2BProvider({ runtime: 'python' })
      expect(provider).toBeDefined()
    })
  })

  describe('doExecute', () => {
    it('should execute Python code', async () => {
      const mockExecution = {
        logs: {
          stdout: ['Hello World'],
          stderr: []
        },
        error: null
      }

      const mockSandbox = createMockSandbox()
      mockSandbox.runCode.mockResolvedValue(mockExecution)
      
      const { Sandbox } = await import('@e2b/code-interpreter')
      vi.mocked(Sandbox.create).mockResolvedValue(mockSandbox as any)

      const provider = new E2BProvider({})
      const result = await provider.doExecute('print("Hello World")')
      
      expect(result.stdout).toBe('Hello World')
      expect(result.stderr).toBe('')
      expect(result.exitCode).toBe(0)
      expect(result.provider).toBe('e2b')
      expect(result.executionTime).toBeGreaterThanOrEqual(0)
    })

    it('should execute code with different runtimes', async () => {
      const mockExecution = {
        logs: {
          stdout: ['Hello World'],
          stderr: []
        },
        error: null
      }

      const mockSandbox = createMockSandbox()
      mockSandbox.runCode.mockResolvedValue(mockExecution)
      
      const { Sandbox } = await import('@e2b/code-interpreter')
      vi.mocked(Sandbox.create).mockResolvedValue(mockSandbox as any)

      const provider = new E2BProvider({})
      const result = await provider.doExecute('console.log("test")', 'node')
      
      expect(result.stdout).toBe('Hello World')
      expect(result.stderr).toBe('')
      expect(result.exitCode).toBe(0)
    })

    it('should handle E2B execution errors', async () => {
      const { Sandbox } = await import('@e2b/code-interpreter')
      vi.mocked(Sandbox.create).mockRejectedValue(new Error('E2B connection failed'))

      const provider = new E2BProvider({})
      
      await expect(provider.doExecute('print("test")'))
        .rejects.toThrow('Failed to initialize E2B session: E2B connection failed')
    })
  })

  describe('doKill', () => {
    it('should close E2B session', async () => {
      const mockExecution = {
        logs: {
          stdout: ['test'],
          stderr: []
        },
        error: null
      }

      const mockSandbox = createMockSandbox()
      mockSandbox.runCode.mockResolvedValue(mockExecution)
      
      const { Sandbox } = await import('@e2b/code-interpreter')
      vi.mocked(Sandbox.create).mockResolvedValue(mockSandbox as any)

      const provider = new E2BProvider({})
      
      // Initialize session by calling doExecute
      await provider.doExecute('print("test")')
      
      await provider.doKill()
      
      expect(mockSandbox.kill).toHaveBeenCalled()
    })

    it('should handle no active session', async () => {
      const provider = new E2BProvider({})
      
      await expect(provider.doKill()).resolves.not.toThrow()
    })
  })

  describe('doGetInfo', () => {
    it('should return sandbox information', async () => {
      const mockSandbox = createMockSandbox()
      
      const { Sandbox } = await import('@e2b/code-interpreter')
      vi.mocked(Sandbox.create).mockResolvedValue(mockSandbox as any)

      const provider = new E2BProvider({})
      const info = await provider.doGetInfo()
      
      expect(info.provider).toBe('e2b')
      expect(info.runtime).toBe('python')
      expect(info.status).toBe('running')
      expect(info.metadata?.e2bSessionId).toBe(provider.sandboxId)
    })
  })
})

describe('e2b factory function', () => {
  beforeEach(() => {
    vi.stubEnv('E2B_API_KEY', 'e2b_test_1234567890abcdef1234567890abcdef12345678')
  })

  it('should create E2B provider with default config', () => {
    const sandbox = e2b()
    
    expect(sandbox).toBeInstanceOf(E2BProvider)
    expect(sandbox.provider).toBe('e2b')
  })

  it('should create E2B provider with custom config', () => {
    const sandbox = e2b({ timeout: 60000 })
    
    expect(sandbox).toBeInstanceOf(E2BProvider)
  })
})