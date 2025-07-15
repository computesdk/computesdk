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
  // E2B SDK uses 'files' not 'fileSystem'
  files: {
    read: vi.fn(),
    write: vi.fn(),
    makeDir: vi.fn(),
    list: vi.fn(),
    exists: vi.fn(),
    remove: vi.fn()
  },
  commands: {},
  // Mock PTY interface for interactive terminals
  pty: {
    create: vi.fn().mockResolvedValue({
      pid: 1234,
      onData: vi.fn(),
      onExit: vi.fn()
    }),
    sendInput: vi.fn(),
    resize: vi.fn(),
    kill: vi.fn()
  },
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
      expect(provider.sandboxId).toBeDefined()
      expect(typeof provider.sandboxId).toBe('string')
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

  describe('filesystem operations', () => {
    let mockSandbox: ReturnType<typeof createMockSandbox>

    beforeEach(async () => {
      mockSandbox = createMockSandbox()
      const { Sandbox } = await import('@e2b/code-interpreter')
      vi.mocked(Sandbox.create).mockResolvedValue(mockSandbox as any)
    })

    describe('readFile', () => {
      it('should read file contents', async () => {
        mockSandbox.files.read.mockResolvedValue('Hello, World!')

        const provider = new E2BProvider({})
        const content = await provider.filesystem.readFile('/test/file.txt')
        
        expect(content).toBe('Hello, World!')
        expect(mockSandbox.files.read).toHaveBeenCalledWith('/test/file.txt', { format: 'text' })
      })

      it('should handle file read errors', async () => {
        mockSandbox.files.read.mockRejectedValue(new Error('File not found'))

        const provider = new E2BProvider({})
        
        await expect(provider.filesystem.readFile('/nonexistent.txt'))
          .rejects.toThrow('Failed to read file: File not found')
      })
    })

    describe('writeFile', () => {
      it('should write file contents', async () => {
        mockSandbox.files.write.mockResolvedValue(undefined)

        const provider = new E2BProvider({})
        await provider.filesystem.writeFile('/test/output.txt', 'Hello, World!')
        
        expect(mockSandbox.files.write).toHaveBeenCalledWith('/test/output.txt', 'Hello, World!')
      })

      it('should handle write errors', async () => {
        mockSandbox.files.write.mockRejectedValue(new Error('Permission denied'))

        const provider = new E2BProvider({})
        
        await expect(provider.filesystem.writeFile('/readonly.txt', 'content'))
          .rejects.toThrow('Failed to write file: Permission denied')
      })
    })

    describe('exists', () => {
      it('should check if file exists', async () => {
        mockSandbox.files.exists.mockResolvedValue(true)

        const provider = new E2BProvider({})
        const exists = await provider.filesystem.exists('/test/file.txt')
        
        expect(exists).toBe(true)
        expect(mockSandbox.files.exists).toHaveBeenCalledWith('/test/file.txt')
      })

      it('should return false for non-existent files', async () => {
        mockSandbox.files.exists.mockResolvedValue(false)

        const provider = new E2BProvider({})
        const exists = await provider.filesystem.exists('/nonexistent.txt')
        
        expect(exists).toBe(false)
      })

      it('should return false on error', async () => {
        mockSandbox.files.exists.mockRejectedValue(new Error('Access denied'))

        const provider = new E2BProvider({})
        const exists = await provider.filesystem.exists('/protected.txt')
        
        expect(exists).toBe(false)
      })
    })

    describe('readdir', () => {
      it('should list directory contents', async () => {
        const mockEntries = [
          {
            name: 'file1.txt',
            path: '/test/file1.txt',
            isDir: false,
            size: 1024,
            lastModified: Date.now()
          },
          {
            name: 'subdir',
            path: '/test/subdir',
            isDir: true,
            size: 0,
            lastModified: Date.now()
          }
        ]

        mockSandbox.files.list.mockResolvedValue(mockEntries)

        const provider = new E2BProvider({})
        const entries = await provider.filesystem.readdir('/test')
        
        expect(entries).toHaveLength(2)
        expect(entries[0].name).toBe('file1.txt')
        expect(entries[0].isDirectory).toBe(false)
        expect(entries[1].name).toBe('subdir')
        expect(entries[1].isDirectory).toBe(true)
        expect(mockSandbox.files.list).toHaveBeenCalledWith('/test')
      })

      it('should handle readdir errors', async () => {
        mockSandbox.files.list.mockRejectedValue(new Error('Directory not found'))

        const provider = new E2BProvider({})
        
        await expect(provider.filesystem.readdir('/nonexistent'))
          .rejects.toThrow('Failed to read directory: Directory not found')
      })
    })

    describe('mkdir', () => {
      it('should create directory', async () => {
        mockSandbox.files.makeDir.mockResolvedValue(undefined)

        const provider = new E2BProvider({})
        await provider.filesystem.mkdir('/test/newdir')
        
        expect(mockSandbox.files.makeDir).toHaveBeenCalledWith('/test/newdir')
      })

      it('should handle mkdir errors', async () => {
        mockSandbox.files.makeDir.mockRejectedValue(new Error('Permission denied'))

        const provider = new E2BProvider({})
        
        await expect(provider.filesystem.mkdir('/readonly/dir'))
          .rejects.toThrow('Failed to create directory: Permission denied')
      })
    })

    describe('remove', () => {
      it('should remove file or directory', async () => {
        mockSandbox.files.remove.mockResolvedValue(undefined)

        const provider = new E2BProvider({})
        await provider.filesystem.remove('/test/file.txt')
        
        expect(mockSandbox.files.remove).toHaveBeenCalledWith('/test/file.txt')
      })

      it('should handle remove errors', async () => {
        mockSandbox.files.remove.mockRejectedValue(new Error('File not found'))

        const provider = new E2BProvider({})
        
        await expect(provider.filesystem.remove('/nonexistent.txt'))
          .rejects.toThrow('Failed to remove: File not found')
      })
    })
  })

  describe('terminal operations', () => {
    let mockSandbox: ReturnType<typeof createMockSandbox>

    beforeEach(async () => {
      mockSandbox = createMockSandbox()
      const { Sandbox } = await import('@e2b/code-interpreter')
      vi.mocked(Sandbox.create).mockResolvedValue(mockSandbox as any)
    })

    describe('create', () => {
      it('should create a terminal session', async () => {
        const mockPtyHandle = { pid: 1234 }
        mockSandbox.pty.create.mockResolvedValue(mockPtyHandle)

        const provider = new E2BProvider({})
        const terminal = await provider.terminal.create({ command: 'bash' })
        
        expect(terminal.pid).toBe(1234)
        expect(terminal.command).toBe('bash')
        expect(terminal.status).toBe('running')
        expect(terminal.cols).toBe(80)
        expect(terminal.rows).toBe(24)
        expect(terminal.write).toBeDefined()
        expect(terminal.resize).toBeDefined()
        expect(terminal.kill).toBeDefined()
      })

      it('should default to bash', async () => {
        const mockPtyHandle = { pid: 1234 }
        mockSandbox.pty.create.mockResolvedValue(mockPtyHandle)

        const provider = new E2BProvider({})
        const terminal = await provider.terminal.create()
        
        expect(terminal.command).toBe('bash')
      })

      it('should support custom dimensions', async () => {
        const mockPtyHandle = { pid: 1234 }
        mockSandbox.pty.create.mockResolvedValue(mockPtyHandle)

        const provider = new E2BProvider({})
        const terminal = await provider.terminal.create({ cols: 120, rows: 40 })
        
        expect(terminal.cols).toBe(120)
        expect(terminal.rows).toBe(40)
        expect(mockSandbox.pty.create).toHaveBeenCalledWith({ cols: 120, rows: 40, onData: expect.any(Function) })
      })
    })

    describe('terminal session methods', () => {
      it('should write data to terminal', async () => {
        const mockPtyHandle = { pid: 1234 }
        mockSandbox.pty.create.mockResolvedValue(mockPtyHandle)

        const provider = new E2BProvider({})
        const terminal = await provider.terminal.create()
        
        await terminal.write('echo "Hello"')
        
        expect(mockSandbox.pty.sendInput).toHaveBeenCalledWith(1234, new TextEncoder().encode('echo "Hello"'))
      })

      it('should write binary data to terminal', async () => {
        const mockPtyHandle = { pid: 1234 }
        mockSandbox.pty.create.mockResolvedValue(mockPtyHandle)

        const provider = new E2BProvider({})
        const terminal = await provider.terminal.create()
        
        const binaryData = new Uint8Array([1, 2, 3])
        await terminal.write(binaryData)
        
        expect(mockSandbox.pty.sendInput).toHaveBeenCalledWith(1234, binaryData)
      })

      it('should handle write errors', async () => {
        const mockPtyHandle = { pid: 1234 }
        mockSandbox.pty.create.mockResolvedValue(mockPtyHandle)
        mockSandbox.pty.sendInput.mockRejectedValue(new Error('PTY send failed'))

        const provider = new E2BProvider({})
        const terminal = await provider.terminal.create()
        
        await expect(terminal.write('invalid'))
          .rejects.toThrow('PTY send failed')
      })

      it('should resize terminal', async () => {
        const mockPtyHandle = { pid: 1234 }
        mockSandbox.pty.create.mockResolvedValue(mockPtyHandle)

        const provider = new E2BProvider({})
        const terminal = await provider.terminal.create()
        
        await terminal.resize(100, 50)
        
        expect(mockSandbox.pty.resize).toHaveBeenCalledWith(1234, { cols: 100, rows: 50 })
        expect(terminal.cols).toBe(100)
        expect(terminal.rows).toBe(50)
      })

      it('should kill terminal session', async () => {
        const mockPtyHandle = { pid: 1234 }
        mockSandbox.pty.create.mockResolvedValue(mockPtyHandle)

        const provider = new E2BProvider({})
        const terminal = await provider.terminal.create()
        
        await terminal.kill()
        
        expect(mockSandbox.pty.kill).toHaveBeenCalledWith(1234)
        expect(terminal.status).toBe('exited')
      })
    })

    describe('list', () => {
      it('should return empty list when no terminals exist', async () => {
        const provider = new E2BProvider({})
        const terminals = await provider.terminal.list()
        
        expect(terminals).toEqual([])
      })

      it('should return active terminals with methods', async () => {
        const mockPtyHandle = { pid: 1234 }
        mockSandbox.pty.create.mockResolvedValue(mockPtyHandle)

        const provider = new E2BProvider({})
        await provider.terminal.create({ command: 'bash' })
        
        const terminals = await provider.terminal.list()
        
        expect(terminals).toHaveLength(1)
        expect(terminals[0].pid).toBe(1234)
        expect(terminals[0].command).toBe('bash')
        expect(terminals[0].status).toBe('running')
        expect(terminals[0].write).toBeDefined()
        expect(terminals[0].resize).toBeDefined()
        expect(terminals[0].kill).toBeDefined()
      })
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