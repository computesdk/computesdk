import { describe, it, expect, vi, beforeEach } from 'vitest'
import { DaytonaProvider, daytona } from '../index'

// Mock the Daytona SDK
vi.mock('@daytonaio/sdk', () => ({
  Daytona: vi.fn()
}))

// Create a mock sandbox that matches the Daytona interface
const createMockSandbox = () => ({
  id: 'daytona-session-123',
  process: {
    codeRun: vi.fn().mockImplementation((code: string) => ({
      result: `Executed: ${code}`,
      error: '',
      exitCode: 0
    })),
    executeCommand: vi.fn().mockImplementation((command: string) => ({
      result: `Command executed: ${command}`,
      error: '',
      exitCode: 0
    }))
  },
  delete: vi.fn().mockResolvedValue(undefined)
})

const mockDaytona = {
  create: vi.fn().mockResolvedValue(createMockSandbox())
}

describe('DaytonaProvider', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    vi.unstubAllEnvs()
    vi.stubEnv('DAYTONA_API_KEY', 'daytona_test_1234567890abcdef1234567890abcdef12345678')
    
    // Setup the Daytona mock
    const { Daytona } = await import('@daytonaio/sdk')
    vi.mocked(Daytona).mockImplementation(() => mockDaytona as any)
  })

  describe('constructor', () => {
    it('should create provider with default config', () => {
      const provider = new DaytonaProvider({})
      
      expect(provider.provider).toBe('daytona')
      expect(provider.sandboxId).toBeDefined()
      expect(typeof provider.sandboxId).toBe('string')
    })

    it('should throw error without API key', () => {
      vi.unstubAllEnvs()
      
      expect(() => new DaytonaProvider({})).toThrow(
        'Missing Daytona API key. Set DAYTONA_API_KEY environment variable.'
      )
    })

    it('should accept different runtimes', () => {
      const provider = new DaytonaProvider({ runtime: 'node' })
      expect(provider).toBeDefined()
    })

    it('should accept python runtime', () => {
      const provider = new DaytonaProvider({ runtime: 'python' })
      expect(provider).toBeDefined()
    })
  })

  describe('doExecute', () => {
    it('should execute Python code', async () => {
      const provider = new DaytonaProvider({})
      const result = await provider.doExecute('print("Hello World")')
      
      expect(result.stdout).toContain('Executed: print("Hello World")')
      expect(result.stderr).toBe('')
      expect(result.exitCode).toBe(0)
      expect(result.provider).toBe('daytona')
      expect(result.executionTime).toBeGreaterThanOrEqual(0)
    })

    it('should execute code with different runtimes', async () => {
      const provider = new DaytonaProvider({})
      const result = await provider.doExecute('console.log("test")', 'node')
      
      expect(result.stdout).toContain('Executed: console.log("test")')
      expect(result.stderr).toBe('')
      expect(result.exitCode).toBe(0)
    })
  })

  describe('runCommand', () => {
    it('should execute commands', async () => {
      const provider = new DaytonaProvider({})
      const result = await provider.runCommand('ls', ['-la'])
      
      expect(result.stdout).toContain('Command executed: ls -la')
      expect(result.stderr).toBe('')
      expect(result.exitCode).toBe(0)
      expect(result.provider).toBe('daytona')
    })

    it('should execute commands without args', async () => {
      const provider = new DaytonaProvider({})
      const result = await provider.runCommand('pwd')
      
      expect(result.stdout).toContain('Command executed: pwd')
      expect(result.stderr).toBe('')
      expect(result.exitCode).toBe(0)
    })
  })

  describe('doKill', () => {
    it('should handle no active session', async () => {
      const provider = new DaytonaProvider({})
      
      await expect(provider.doKill()).resolves.not.toThrow()
    })

    it('should kill active session', async () => {
      const provider = new DaytonaProvider({})
      
      // Initialize session by calling doExecute
      await provider.doExecute('print("test")')
      
      await expect(provider.doKill()).resolves.not.toThrow()
    })
  })

  describe('doGetInfo', () => {
    it('should return sandbox information', async () => {
      const provider = new DaytonaProvider({})
      const info = await provider.doGetInfo()
      
      expect(info.provider).toBe('daytona')
      expect(info.runtime).toBe('python')
      expect(info.status).toBe('running')
      expect(info.metadata?.daytonaSessionId).toBe(provider.sandboxId)
    })
  })

  describe('filesystem operations', () => {
    describe('readFile', () => {
      it('should throw not implemented error', async () => {
        const provider = new DaytonaProvider({})
        
        await expect(provider.filesystem.readFile('/test/file.txt'))
          .rejects.toThrow('Daytona file read not implemented yet')
      })
    })

    describe('writeFile', () => {
      it('should throw not implemented error', async () => {
        const provider = new DaytonaProvider({})
        
        await expect(provider.filesystem.writeFile('/test/output.txt', 'Hello, World!'))
          .rejects.toThrow('Daytona file write not implemented yet')
      })
    })

    describe('exists', () => {
      it('should return false for not implemented', async () => {
        const provider = new DaytonaProvider({})
        const exists = await provider.filesystem.exists('/test/file.txt')
        
        expect(exists).toBe(false)
      })
    })

    describe('readdir', () => {
      it('should throw not implemented error', async () => {
        const provider = new DaytonaProvider({})
        
        await expect(provider.filesystem.readdir('/test'))
          .rejects.toThrow('Daytona readdir not implemented yet')
      })
    })

    describe('mkdir', () => {
      it('should throw not implemented error', async () => {
        const provider = new DaytonaProvider({})
        
        await expect(provider.filesystem.mkdir('/test/newdir'))
          .rejects.toThrow('Daytona mkdir not implemented yet')
      })
    })

    describe('remove', () => {
      it('should throw not implemented error', async () => {
        const provider = new DaytonaProvider({})
        
        await expect(provider.filesystem.remove('/test/file.txt'))
          .rejects.toThrow('Daytona remove not implemented yet')
      })
    })
  })
})

describe('daytona factory function', () => {
  beforeEach(async () => {
    vi.stubEnv('DAYTONA_API_KEY', 'daytona_test_1234567890abcdef1234567890abcdef12345678')
    
    // Setup the Daytona mock
    const { Daytona } = await import('@daytonaio/sdk')
    vi.mocked(Daytona).mockImplementation(() => mockDaytona as any)
  })

  it('should create Daytona provider with default config', () => {
    const sandbox = daytona()
    
    expect(sandbox).toBeInstanceOf(DaytonaProvider)
    expect(sandbox.provider).toBe('daytona')
  })

  it('should create Daytona provider with custom config', () => {
    const sandbox = daytona({ timeout: 60000 })
    
    expect(sandbox).toBeInstanceOf(DaytonaProvider)
  })
})