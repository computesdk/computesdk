import { describe, it, expect, vi, beforeEach } from 'vitest'
import { vercel } from '../index'

// Mock the @vercel/sandbox module
vi.mock('@vercel/sandbox', () => ({
  Sandbox: {
    create: vi.fn()
  }
}))

// Helper function to create a mock Vercel sandbox
function createMockVercelSandbox() {
  return {
    runCode: vi.fn(),
    runCommand: vi.fn(),
    writeFiles: vi.fn(),
    readFiles: vi.fn(),
    mkDir: vi.fn(),
    kill: vi.fn(),
    close: vi.fn()
  }
}

describe('VercelProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('VERCEL_TOKEN', 'vercel_test_token_1234567890abcdef')
    vi.stubEnv('VERCEL_TEAM_ID', 'team_test_1234567890abcdef')
    vi.stubEnv('VERCEL_PROJECT_ID', 'prj_test_1234567890abcdef')
  })

  describe('Provider interface', () => {
    it('should implement Provider interface correctly', () => {
      const provider = new VercelProvider({})
      
      expect(provider.name).toBe('vercel')
      expect(provider.sandbox).toBeDefined()
      expect(typeof provider.sandbox.create).toBe('function')

      expect(typeof provider.sandbox.getById).toBe('function')
      expect(typeof provider.sandbox.list).toBe('function')
      expect(typeof provider.sandbox.destroy).toBe('function')
    })

    it('should throw error without VERCEL_TOKEN', () => {
      vi.unstubAllEnvs()
      vi.stubEnv('VERCEL_TEAM_ID', 'team_test_1234567890abcdef')
      vi.stubEnv('VERCEL_PROJECT_ID', 'prj_test_1234567890abcdef')
      
      expect(() => new VercelProvider({})).toThrow('Missing Vercel token. Provide \'token\' in config or set VERCEL_TOKEN environment variable. Get your token from https://vercel.com/account/tokens')
    })

    it('should throw error without VERCEL_TEAM_ID', () => {
      vi.unstubAllEnvs()
      vi.stubEnv('VERCEL_TOKEN', 'vercel_test_token_1234567890abcdef')
      vi.stubEnv('VERCEL_PROJECT_ID', 'prj_test_1234567890abcdef')
      
      expect(() => new VercelProvider({})).toThrow('Missing Vercel team ID. Provide \'teamId\' in config or set VERCEL_TEAM_ID environment variable.')
    })

    it('should throw error without VERCEL_PROJECT_ID', () => {
      vi.unstubAllEnvs()
      vi.stubEnv('VERCEL_TOKEN', 'vercel_test_token_1234567890abcdef')
      vi.stubEnv('VERCEL_TEAM_ID', 'team_test_1234567890abcdef')
      
      expect(() => new VercelProvider({})).toThrow('Missing Vercel project ID. Provide \'projectId\' in config or set VERCEL_PROJECT_ID environment variable.')
    })

    it('should accept different runtimes', () => {
      expect(() => new VercelProvider({ runtime: 'node' })).not.toThrow()
      expect(() => new VercelProvider({ runtime: 'python' })).not.toThrow()
    })

    it('should accept python runtime', () => {
      const provider = new VercelProvider({ runtime: 'python' })
      expect(provider).toBeInstanceOf(VercelProvider)
    })

    it('should throw error for invalid runtime', () => {
      expect(() => new VercelProvider({ runtime: 'invalid' as any })).toThrow('Vercel provider only supports Node.js and Python runtimes')
    })
  })

  describe('VercelSandboxManager', () => {
    it('should create sandbox with correct parameters', async () => {
      const { Sandbox } = await import('@vercel/sandbox')
      const mockSandbox = createMockVercelSandbox()
      vi.mocked(Sandbox.create).mockResolvedValue(mockSandbox as any)

      const provider = new VercelProvider({})
      const sandbox = await provider.sandbox.create()
      
      expect(Sandbox.create).toHaveBeenCalledWith({
        token: 'vercel_test_token_1234567890abcdef',
        teamId: 'team_test_1234567890abcdef',
        projectId: 'prj_test_1234567890abcdef',
        runtime: 'node22',
        timeout: 300000
      })
      expect(sandbox).toBeDefined()
    })

    it('should get existing sandbox by ID', async () => {
      const { Sandbox } = await import('@vercel/sandbox')
      const mockSandbox = createMockVercelSandbox()
      vi.mocked(Sandbox.create).mockResolvedValue(mockSandbox as any)

      const provider = new VercelProvider({})
      const sandbox = await provider.sandbox.getById('test-sandbox-id')
      
      expect(sandbox).toBeDefined()
    })

    it('should handle authentication errors', async () => {
      const { Sandbox } = await import('@vercel/sandbox')
      vi.mocked(Sandbox.create).mockRejectedValue(new Error('Authentication failed'))

      const provider = new VercelProvider({})
      
      await expect(provider.sandbox.create()).rejects.toThrow('Authentication failed')
    })

    it('should handle team/project errors', async () => {
      const { Sandbox } = await import('@vercel/sandbox')
      vi.mocked(Sandbox.create).mockRejectedValue(new Error('Team or project not found'))

      const provider = new VercelProvider({})
      
      await expect(provider.sandbox.create()).rejects.toThrow('Vercel team/project configuration failed. Please check your VERCEL_TEAM_ID and VERCEL_PROJECT_ID environment variables.')
    })

    it('should handle quota errors', async () => {
      const { Sandbox } = await import('@vercel/sandbox')
      vi.mocked(Sandbox.create).mockRejectedValue(new Error('Quota exceeded'))

      const provider = new VercelProvider({})
      
      await expect(provider.sandbox.create()).rejects.toThrow('Quota exceeded')
    })

    it('should list sandboxes', async () => {
      const provider = new VercelProvider({})
      const sandboxes = await provider.sandbox.list()
      
      expect(Array.isArray(sandboxes)).toBe(true)
    })

    it('should destroy sandbox', async () => {
      const provider = new VercelProvider({})
      
      await expect(provider.sandbox.destroy('test-sandbox-id')).resolves.not.toThrow()
    })
  })

  describe('Sandbox functionality', () => {
    it('should execute Node.js code', async () => {
      const { Sandbox } = await import('@vercel/sandbox')
      const mockSandbox = createMockVercelSandbox()
      mockSandbox.runCommand.mockResolvedValue({
        exitCode: 0,
        stdout: vi.fn().mockResolvedValue('Hello Node.js'),
        stderr: vi.fn().mockResolvedValue('')
      })
      vi.mocked(Sandbox.create).mockResolvedValue(mockSandbox as any)
      
      const provider = new VercelProvider({})
      const sandbox = await provider.sandbox.create()
      const result = await sandbox.runCode('console.log("Hello Node.js")')
      
      expect(result.stdout).toBe('Hello Node.js')
      expect(result.stderr).toBe('')
      expect(result.exitCode).toBe(0)
    })

    it('should execute Python code', async () => {
      const { Sandbox } = await import('@vercel/sandbox')
      const mockSandbox = createMockVercelSandbox()
      mockSandbox.runCommand.mockResolvedValue({
        exitCode: 0,
        stdout: vi.fn().mockResolvedValue('Hello Python'),
        stderr: vi.fn().mockResolvedValue('')
      })
      vi.mocked(Sandbox.create).mockResolvedValue(mockSandbox as any)
      
      const provider = new VercelProvider({})
      const sandbox = await provider.sandbox.create()
      const result = await sandbox.runCode('print("Hello Python")', 'python')
      
      expect(result.stdout).toBe('Hello Python')
      expect(result.stderr).toBe('')
      expect(result.exitCode).toBe(0)
    })

    it('should execute shell commands', async () => {
      const { Sandbox } = await import('@vercel/sandbox')
      const mockSandbox = createMockVercelSandbox()
      mockSandbox.runCommand.mockResolvedValue({
        exitCode: 0,
        stdout: 'file1.txt\nfile2.txt',
        stderr: ''
      })
      vi.mocked(Sandbox.create).mockResolvedValue(mockSandbox as any)
      
      const provider = new VercelProvider({})
      const sandbox = await provider.sandbox.create()
      const result = await sandbox.runCommand('ls', ['-la'])
      
      expect(result.stdout).toBe('file1.txt\nfile2.txt')
      expect(result.exitCode).toBe(0)
    })

    it('should handle execution errors', async () => {
      const { Sandbox } = await import('@vercel/sandbox')
      const mockSandbox = createMockVercelSandbox()
      mockSandbox.runCommand.mockResolvedValue({
        exitCode: 1,
        stdout: '',
        stderr: 'Error: Test error'
      })
      vi.mocked(Sandbox.create).mockResolvedValue(mockSandbox as any)
      
      const provider = new VercelProvider({})
      const sandbox = await provider.sandbox.create()
      const result = await sandbox.runCode('throw new Error("Test error")')
      
      expect(result.exitCode).toBe(1)
      expect(result.stderr).toBe('Error: Test error')
    })
  })

  describe('Filesystem operations', () => {
    it('should throw not implemented error for readFile', async () => {
      const { Sandbox } = await import('@vercel/sandbox')
      const mockSandbox = createMockVercelSandbox()
      vi.mocked(Sandbox.create).mockResolvedValue(mockSandbox as any)

      const provider = new VercelProvider({})
      const sandbox = await provider.sandbox.create()
      
      await expect(sandbox.filesystem.readFile('/test/file.txt')).rejects.toThrow('Filesystem operations are not supported by Vercel\'s sandbox environment')
    })

    it('should throw not implemented error for writeFile', async () => {
      const { Sandbox } = await import('@vercel/sandbox')
      const mockSandbox = createMockVercelSandbox()
      vi.mocked(Sandbox.create).mockResolvedValue(mockSandbox as any)

      const provider = new VercelProvider({})
      const sandbox = await provider.sandbox.create()
      
      await expect(sandbox.filesystem.writeFile('/test/output.txt', 'Hello, World!')).rejects.toThrow('Filesystem operations are not supported by Vercel\'s sandbox environment')
    })

    it('should throw not implemented error for exists', async () => {
      const { Sandbox } = await import('@vercel/sandbox')
      const mockSandbox = createMockVercelSandbox()
      vi.mocked(Sandbox.create).mockResolvedValue(mockSandbox as any)

      const provider = new VercelProvider({})
      const sandbox = await provider.sandbox.create()
      
      await expect(sandbox.filesystem.exists('/test/file.txt')).rejects.toThrow('Filesystem operations are not supported by Vercel\'s sandbox environment')
    })

    it('should throw not implemented error for mkdir', async () => {
      const { Sandbox } = await import('@vercel/sandbox')
      const mockSandbox = createMockVercelSandbox()
      vi.mocked(Sandbox.create).mockResolvedValue(mockSandbox as any)

      const provider = new VercelProvider({})
      const sandbox = await provider.sandbox.create()
      
      await expect(sandbox.filesystem.mkdir('/test/newdir')).rejects.toThrow('Filesystem operations are not supported by Vercel\'s sandbox environment')
    })

    it('should throw not implemented error for readdir', async () => {
      const { Sandbox } = await import('@vercel/sandbox')
      const mockSandbox = createMockVercelSandbox()
      vi.mocked(Sandbox.create).mockResolvedValue(mockSandbox as any)

      const provider = new VercelProvider({})
      const sandbox = await provider.sandbox.create()
      
      await expect(sandbox.filesystem.readdir('/test')).rejects.toThrow('Filesystem operations are not supported by Vercel\'s sandbox environment')
    })

    it('should throw not implemented error for remove', async () => {
      const { Sandbox } = await import('@vercel/sandbox')
      const mockSandbox = createMockVercelSandbox()
      vi.mocked(Sandbox.create).mockResolvedValue(mockSandbox as any)

      const provider = new VercelProvider({})
      const sandbox = await provider.sandbox.create()
      
      await expect(sandbox.filesystem.remove('/test/file.txt')).rejects.toThrow('Filesystem operations are not supported by Vercel\'s sandbox environment')
    })
  })
})

describe('vercel factory function', () => {
  beforeEach(() => {
    vi.stubEnv('VERCEL_TOKEN', 'vercel_test_token_1234567890abcdef')
    vi.stubEnv('VERCEL_TEAM_ID', 'team_test_1234567890abcdef')
    vi.stubEnv('VERCEL_PROJECT_ID', 'prj_test_1234567890abcdef')
  })

  it('should create Vercel provider with default config', () => {
    const provider = vercel()
    
    expect(provider).toBeInstanceOf(VercelProvider)
  })

  it('should create Vercel provider with custom config', () => {
    const provider = vercel({ runtime: 'python' })
    
    expect(provider).toBeInstanceOf(VercelProvider)
  })
})