import { describe, it, expect, vi, beforeEach } from 'vitest'
import { E2BProvider, e2b } from '../index'

// Mock the E2B SDK
vi.mock('@e2b/code-interpreter', () => ({
  Sandbox: {
    create: vi.fn(),
    connect: vi.fn()
  }
}))

// Create a mock E2B sandbox that matches the real interface
const createMockE2BSandbox = (sandboxId = 'e2b-session-123') => ({
  sandboxId,
  runCode: vi.fn(),
  kill: vi.fn(),
  files: {
    read: vi.fn(),
    write: vi.fn(),
    makeDir: vi.fn(),
    list: vi.fn(),
    exists: vi.fn(),
    remove: vi.fn()
  },
  pty: {
    create: vi.fn().mockResolvedValue({
      pid: 1234,
      onData: vi.fn(),
      onExit: vi.fn()
    }),
    sendInput: vi.fn(),
    resize: vi.fn(),
    kill: vi.fn()
  }
})

describe('E2BProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.unstubAllEnvs()
    vi.stubEnv('E2B_API_KEY', 'e2b_test_1234567890abcdef1234567890abcdef12345678')
  })

  describe('Provider interface', () => {
    it('should implement Provider interface correctly', () => {
      const provider = new E2BProvider({})
      
      expect(provider.name).toBe('e2b')
      expect(provider.sandbox).toBeDefined()
      expect(typeof provider.sandbox.create).toBe('function')
      expect(typeof provider.sandbox.getById).toBe('function')
      expect(typeof provider.sandbox.list).toBe('function')
      expect(typeof provider.sandbox.destroy).toBe('function')
    })

    it('should throw error without API key', () => {
      vi.unstubAllEnvs()
      
      expect(() => new E2BProvider({})).toThrow(
        'Missing E2B API key. Provide \'apiKey\' in config or set E2B_API_KEY environment variable.'
      )
    })

    it('should throw error with invalid API key format', () => {
      vi.unstubAllEnvs()
      vi.stubEnv('E2B_API_KEY', 'invalid_key_format')
      
      expect(() => new E2BProvider({})).toThrow(
        'Invalid E2B API key format. E2B API keys should start with \'e2b_\'.'
      )
    })

    it('should accept API key from config', () => {
      vi.unstubAllEnvs()
      
      const provider = new E2BProvider({ 
        apiKey: 'e2b_config_1234567890abcdef1234567890abcdef12345678' 
      })
      
      expect(provider.name).toBe('e2b')
    })
  })

  describe('sandbox.create()', () => {
    it('should create new sandbox', async () => {
      const mockE2BSandbox = createMockE2BSandbox()
      const { Sandbox } = await import('@e2b/code-interpreter')
      vi.mocked(Sandbox.create).mockResolvedValue(mockE2BSandbox as any)

      const provider = new E2BProvider({})
      const sandbox = await provider.sandbox.create()
      
      expect(sandbox.sandboxId).toBe('e2b-session-123')
      expect(sandbox.provider).toBe('e2b')
      expect(sandbox.filesystem).toBeDefined()
      expect(sandbox.terminal).toBeDefined()
      expect(typeof sandbox.runCode).toBe('function')
      expect(typeof sandbox.runCommand).toBe('function')
      expect(typeof sandbox.getInfo).toBe('function')
      expect(typeof sandbox.kill).toBe('function')
    })

    it('should create sandbox with custom options', async () => {
      const mockE2BSandbox = createMockE2BSandbox()
      const { Sandbox } = await import('@e2b/code-interpreter')
      vi.mocked(Sandbox.create).mockResolvedValue(mockE2BSandbox as any)

      const provider = new E2BProvider({})
      const sandbox = await provider.sandbox.create({ 
        runtime: 'python'
      })
      
      expect(sandbox.provider).toBe('e2b')
    })

    it('should reconnect to existing sandbox with sandboxId', async () => {
      const mockE2BSandbox = createMockE2BSandbox('existing-sandbox-123')
      const { Sandbox } = await import('@e2b/code-interpreter')
      vi.mocked(Sandbox.connect).mockResolvedValue(mockE2BSandbox as any)

      const provider = new E2BProvider({})
      const sandbox = await provider.sandbox.create({ sandboxId: 'existing-sandbox-123' })
      
      expect(sandbox.sandboxId).toBe('existing-sandbox-123')
      expect(Sandbox.connect).toHaveBeenCalledWith('existing-sandbox-123', {
        apiKey: 'e2b_test_1234567890abcdef1234567890abcdef12345678'
      })
    })

    it('should handle E2B creation errors', async () => {
      const { Sandbox } = await import('@e2b/code-interpreter')
      vi.mocked(Sandbox.create).mockRejectedValue(new Error('E2B connection failed'))

      const provider = new E2BProvider({})
      
      await expect(provider.sandbox.create()).rejects.toThrow(
        'Failed to create E2B sandbox: E2B connection failed'
      )
    })

    it('should handle authentication errors', async () => {
      const { Sandbox } = await import('@e2b/code-interpreter')
      vi.mocked(Sandbox.create).mockRejectedValue(new Error('unauthorized API key'))

      const provider = new E2BProvider({})
      
      await expect(provider.sandbox.create()).rejects.toThrow(
        'E2B authentication failed. Please check your E2B_API_KEY environment variable.'
      )
    })

    it('should handle quota errors', async () => {
      const { Sandbox } = await import('@e2b/code-interpreter')
      vi.mocked(Sandbox.create).mockRejectedValue(new Error('quota exceeded'))

      const provider = new E2BProvider({})
      
      await expect(provider.sandbox.create()).rejects.toThrow(
        'E2B quota exceeded. Please check your usage at https://e2b.dev/'
      )
    })
  })

  describe('sandbox.getById()', () => {
    it('should return existing sandbox from cache', async () => {
      const mockE2BSandbox = createMockE2BSandbox('cached-sandbox-123')
      const { Sandbox } = await import('@e2b/code-interpreter')
      vi.mocked(Sandbox.create).mockResolvedValue(mockE2BSandbox as any)

      const provider = new E2BProvider({})
      
      // Create sandbox first to cache it
      await provider.sandbox.create()
      
      // Get it by ID
      const found = await provider.sandbox.getById('cached-sandbox-123')
      
      expect(found).toBeDefined()
      expect(found?.sandboxId).toBe('cached-sandbox-123')
    })

    it('should reconnect to sandbox not in cache', async () => {
      const mockE2BSandbox = createMockE2BSandbox('remote-sandbox-456')
      const { Sandbox } = await import('@e2b/code-interpreter')
      vi.mocked(Sandbox.connect).mockResolvedValue(mockE2BSandbox as any)

      const provider = new E2BProvider({})
      const found = await provider.sandbox.getById('remote-sandbox-456')
      
      expect(found).toBeDefined()
      expect(found?.sandboxId).toBe('remote-sandbox-456')
      expect(Sandbox.connect).toHaveBeenCalledWith('remote-sandbox-456', {
        apiKey: 'e2b_test_1234567890abcdef1234567890abcdef12345678'
      })
    })

    it('should return null for non-existent sandbox', async () => {
      const { Sandbox } = await import('@e2b/code-interpreter')
      vi.mocked(Sandbox.connect).mockRejectedValue(new Error('Sandbox not found'))

      const provider = new E2BProvider({})
      const found = await provider.sandbox.getById('non-existent-sandbox')
      
      expect(found).toBeNull()
    })
  })

  describe('sandbox.list()', () => {
    it('should return empty list when no sandboxes exist', async () => {
      const provider = new E2BProvider({})
      const sandboxes = await provider.sandbox.list()
      
      expect(sandboxes).toEqual([])
    })

    it('should return active sandboxes', async () => {
      const mockE2BSandbox1 = createMockE2BSandbox('sandbox-1')
      const mockE2BSandbox2 = createMockE2BSandbox('sandbox-2')
      const { Sandbox } = await import('@e2b/code-interpreter')
      vi.mocked(Sandbox.create)
        .mockResolvedValueOnce(mockE2BSandbox1 as any)
        .mockResolvedValueOnce(mockE2BSandbox2 as any)

      const provider = new E2BProvider({})
      
      // Create two sandboxes
      await provider.sandbox.create()
      await provider.sandbox.create()
      
      const sandboxes = await provider.sandbox.list()
      
      expect(sandboxes).toHaveLength(2)
      expect(sandboxes[0].sandboxId).toBe('sandbox-1')
      expect(sandboxes[1].sandboxId).toBe('sandbox-2')
    })
  })

  describe('sandbox.destroy()', () => {
    it('should destroy cached sandbox', async () => {
      const mockE2BSandbox = createMockE2BSandbox('destroy-test-123')
      const { Sandbox } = await import('@e2b/code-interpreter')
      vi.mocked(Sandbox.create).mockResolvedValue(mockE2BSandbox as any)

      const provider = new E2BProvider({})
      
      // Create sandbox first
      await provider.sandbox.create()
      
      // Destroy it
      await provider.sandbox.destroy('destroy-test-123')
      
      expect(mockE2BSandbox.kill).toHaveBeenCalled()
      
      // Should be removed from cache
      const sandboxes = await provider.sandbox.list()
      expect(sandboxes).toHaveLength(0)
    })

    it('should attempt to destroy non-cached sandbox', async () => {
      const mockE2BSandbox = createMockE2BSandbox('remote-destroy-456')
      const { Sandbox } = await import('@e2b/code-interpreter')
      vi.mocked(Sandbox.connect).mockResolvedValue(mockE2BSandbox as any)

      const provider = new E2BProvider({})
      
      // Destroy sandbox not in cache
      await provider.sandbox.destroy('remote-destroy-456')
      
      expect(Sandbox.connect).toHaveBeenCalledWith('remote-destroy-456', {
        apiKey: 'e2b_test_1234567890abcdef1234567890abcdef12345678'
      })
      expect(mockE2BSandbox.kill).toHaveBeenCalled()
    })

    it('should handle destroy errors gracefully', async () => {
      const { Sandbox } = await import('@e2b/code-interpreter')
      vi.mocked(Sandbox.connect).mockRejectedValue(new Error('Sandbox not found'))

      const provider = new E2BProvider({})
      
      // Should not throw for non-existent sandbox
      await expect(provider.sandbox.destroy('non-existent')).resolves.not.toThrow()
    })
  })

  describe('Sandbox implementation', () => {
    let mockE2BSandbox: ReturnType<typeof createMockE2BSandbox>
    let sandbox: any

    beforeEach(async () => {
      mockE2BSandbox = createMockE2BSandbox()
      const { Sandbox } = await import('@e2b/code-interpreter')
      vi.mocked(Sandbox.create).mockResolvedValue(mockE2BSandbox as any)

      const provider = new E2BProvider({})
      sandbox = await provider.sandbox.create()
    })

    describe('runCode()', () => {
      it('should execute code and return result', async () => {
        const mockExecution = {
          logs: {
            stdout: ['Hello World'],
            stderr: []
          },
          error: null
        }
        mockE2BSandbox.runCode.mockResolvedValue(mockExecution)

        const result = await sandbox.runCode('print("Hello World")')
        
        expect(result.stdout).toBe('Hello World')
        expect(result.stderr).toBe('')
        expect(result.exitCode).toBe(0)
        expect(result.provider).toBe('e2b')
        expect(result.sandboxId).toBe('e2b-session-123')
        expect(result.executionTime).toBeGreaterThanOrEqual(0)
      })

      it('should handle execution errors', async () => {
        const mockExecution = {
          logs: {
            stdout: [],
            stderr: ['Error: something went wrong']
          },
          error: new Error('Execution failed')
        }
        mockE2BSandbox.runCode.mockResolvedValue(mockExecution)

        const result = await sandbox.runCode('invalid code')
        
        expect(result.stdout).toBe('')
        expect(result.stderr).toBe('Error: something went wrong')
        expect(result.exitCode).toBe(1)
      })

      it('should handle E2B SDK errors', async () => {
        mockE2BSandbox.runCode.mockRejectedValue(new Error('E2B SDK error'))

        await expect(sandbox.runCode('print("test")')).rejects.toThrow(
          'E2B execution failed: E2B SDK error'
        )
      })
    })

    describe('runCommand()', () => {
      it('should execute shell commands', async () => {
        const mockExecution = {
          logs: {
            stdout: ['file1.txt\nfile2.txt'],
            stderr: []
          },
          error: null
        }
        mockE2BSandbox.runCode.mockResolvedValue(mockExecution)

        const result = await sandbox.runCommand('ls', ['-la'])
        
        expect(result.stdout).toBe('file1.txt\nfile2.txt')
        expect(result.exitCode).toBe(0)
        expect(mockE2BSandbox.runCode).toHaveBeenCalledWith(expect.stringContaining('ls -la'))
      })

      it('should handle command without args', async () => {
        const mockExecution = {
          logs: { stdout: ['output'], stderr: [] },
          error: null
        }
        mockE2BSandbox.runCode.mockResolvedValue(mockExecution)

        await sandbox.runCommand('pwd')
        
        expect(mockE2BSandbox.runCode).toHaveBeenCalledWith(expect.stringContaining('pwd'))
      })
    })

    describe('getInfo()', () => {
      it('should return sandbox information', async () => {
        const info = await sandbox.getInfo()
        
        expect(info.id).toBe('e2b-session-123')
        expect(info.provider).toBe('e2b')
        expect(info.runtime).toBe('python')
        expect(info.status).toBe('running')
        expect(info.timeout).toBe(300000)
        expect(info.metadata?.e2bSessionId).toBe('e2b-session-123')
      })
    })

    describe('kill()', () => {
      it('should kill the sandbox', async () => {
        await sandbox.kill()
        
        expect(mockE2BSandbox.kill).toHaveBeenCalled()
      })

      it('should handle kill errors', async () => {
        mockE2BSandbox.kill.mockRejectedValue(new Error('Kill failed'))

        await expect(sandbox.kill()).rejects.toThrow(
          'Failed to kill E2B session: Kill failed'
        )
      })
    })

    describe('filesystem', () => {
      it('should read files', async () => {
        mockE2BSandbox.files.read.mockResolvedValue('file content')

        const content = await sandbox.filesystem.readFile('/test.txt')
        
        expect(content).toBe('file content')
        expect(mockE2BSandbox.files.read).toHaveBeenCalledWith('/test.txt', { format: 'text' })
      })

      it('should write files', async () => {
        await sandbox.filesystem.writeFile('/test.txt', 'content')
        
        expect(mockE2BSandbox.files.write).toHaveBeenCalledWith('/test.txt', 'content')
      })

      it('should create directories', async () => {
        await sandbox.filesystem.mkdir('/newdir')
        
        expect(mockE2BSandbox.files.makeDir).toHaveBeenCalledWith('/newdir')
      })

      it('should list directory contents', async () => {
        const mockEntries = [
          { name: 'file.txt', path: '/file.txt', isDir: false, size: 100, lastModified: Date.now() }
        ]
        mockE2BSandbox.files.list.mockResolvedValue(mockEntries)

        const entries = await sandbox.filesystem.readdir('/')
        
        expect(entries).toHaveLength(1)
        expect(entries[0].name).toBe('file.txt')
        expect(entries[0].isDirectory).toBe(false)
      })

      it('should check file existence', async () => {
        mockE2BSandbox.files.exists.mockResolvedValue(true)

        const exists = await sandbox.filesystem.exists('/test.txt')
        
        expect(exists).toBe(true)
      })

      it('should remove files', async () => {
        await sandbox.filesystem.remove('/test.txt')
        
        expect(mockE2BSandbox.files.remove).toHaveBeenCalledWith('/test.txt')
      })
    })

    describe('terminal', () => {
      it('should create terminal sessions', async () => {
        const mockPtyHandle = { pid: 1234 }
        mockE2BSandbox.pty.create.mockResolvedValue(mockPtyHandle)

        const terminal = await sandbox.terminal.create({ command: 'bash' })
        
        expect(terminal.pid).toBe(1234)
        expect(terminal.command).toBe('bash')
        expect(terminal.status).toBe('running')
        expect(terminal.cols).toBe(80)
        expect(terminal.rows).toBe(24)
      })

      it('should list terminal sessions', async () => {
        const mockPtyHandle = { pid: 1234 }
        mockE2BSandbox.pty.create.mockResolvedValue(mockPtyHandle)

        await sandbox.terminal.create()
        const terminals = await sandbox.terminal.list()
        
        expect(terminals).toHaveLength(1)
        expect(terminals[0].pid).toBe(1234)
      })

      it('should write to terminal', async () => {
        const mockPtyHandle = { pid: 1234 }
        mockE2BSandbox.pty.create.mockResolvedValue(mockPtyHandle)

        const terminal = await sandbox.terminal.create()
        await terminal.write('echo hello')
        
        expect(mockE2BSandbox.pty.sendInput).toHaveBeenCalledWith(1234, new TextEncoder().encode('echo hello'))
      })

      it('should resize terminal', async () => {
        const mockPtyHandle = { pid: 1234 }
        mockE2BSandbox.pty.create.mockResolvedValue(mockPtyHandle)

        const terminal = await sandbox.terminal.create()
        await terminal.resize(100, 50)
        
        expect(mockE2BSandbox.pty.resize).toHaveBeenCalledWith(1234, { cols: 100, rows: 50 })
        expect(terminal.cols).toBe(100)
        expect(terminal.rows).toBe(50)
      })

      it('should kill terminal', async () => {
        const mockPtyHandle = { pid: 1234 }
        mockE2BSandbox.pty.create.mockResolvedValue(mockPtyHandle)

        const terminal = await sandbox.terminal.create()
        await terminal.kill()
        
        expect(mockE2BSandbox.pty.kill).toHaveBeenCalledWith(1234)
        expect(terminal.status).toBe('exited')
      })
    })
  })
})

describe('e2b factory function', () => {
  beforeEach(() => {
    vi.stubEnv('E2B_API_KEY', 'e2b_test_1234567890abcdef1234567890abcdef12345678')
  })

  it('should create E2B provider with default config', () => {
    const provider = e2b()
    
    expect(provider).toBeInstanceOf(E2BProvider)
    expect(provider.name).toBe('e2b')
  })

  it('should create E2B provider with custom config', () => {
    const provider = e2b({ timeout: 60000, runtime: 'node' })
    
    expect(provider).toBeInstanceOf(E2BProvider)
    expect(provider.name).toBe('e2b')
  })
})