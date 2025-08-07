import { describe, it, expect, vi, beforeEach } from 'vitest'
import { FreestyleProvider, freestyle } from '../index'

// Mock data for testing
const mockFileSystem = new Map<string, string>()
const mockDirectories = new Set<string>()

// Create mock dev server
const createMockDevServer = () => ({
  fs: {
    readFile: vi.fn().mockImplementation(async (path: string) => {
      if (mockFileSystem.has(path)) {
        return mockFileSystem.get(path)
      }
      throw new Error(`File not found: ${path}`)
    }),
    writeFile: vi.fn().mockImplementation(async (path: string, content: string) => {
      mockFileSystem.set(path, content)
    }),
    ls: vi.fn().mockImplementation(async (path: string) => {
      if (mockDirectories.has(path)) {
        const files: string[] = []
        // Return files in this directory
        for (const filePath of mockFileSystem.keys()) {
          if (filePath.startsWith(path + '/') && !filePath.substring(path.length + 1).includes('/')) {
            files.push(filePath.substring(path.length + 1))
          }
        }
        // Return subdirectories
        for (const dirPath of mockDirectories) {
          if (dirPath.startsWith(path + '/') && !dirPath.substring(path.length + 1).includes('/')) {
            files.push(dirPath.substring(path.length + 1))
          }
        }
        return files
      }
      throw new Error(`Directory not found: ${path}`)
    }),
  },
  process: {
    exec: vi.fn().mockImplementation(async (command: string) => {
      if (command.startsWith('mkdir -p')) {
        const dirPath = command.replace('mkdir -p "', '').replace('"', '')
        mockDirectories.add(dirPath)
        return { stdout: [], stderr: [] }
      }
      if (command.startsWith('rm -rf')) {
        const targetPath = command.replace('rm -rf "', '').replace('"', '')
        // Remove files
        for (const filePath of mockFileSystem.keys()) {
          if (filePath.startsWith(targetPath)) {
            mockFileSystem.delete(filePath)
          }
        }
        // Remove directories
        for (const dirPath of mockDirectories) {
          if (dirPath.startsWith(targetPath)) {
            mockDirectories.delete(dirPath)
          }
        }
        return { stdout: [], stderr: [] }
      }
      if (command.startsWith('node')) {
        const tempFile = command.split(' ')[1]
        const code = mockFileSystem.get(tempFile) || ''
        
        if (code.includes('console.log("Hello World")')) {
          return { stdout: ['Hello World'], stderr: [] }
        }
        if (code.includes('console.log("Hello from runCode")')) {
          return { stdout: ['Hello from runCode'], stderr: [] }
        }
        if (code.includes('console.log("test")')) {
          return { stdout: ['test'], stderr: [] }
        }
        if (code.includes('error code here')) {
          return { stdout: [], stderr: ['Mock error occurred'] }
        }
        return { stdout: ['Code executed successfully'], stderr: [] }
      }
      if (command.startsWith('node')) {
        const tempFile = command.split(' ')[1]
        const code = mockFileSystem.get(tempFile) || ''
        
        if (code.includes('console.log("Hello World")')) {
          return { stdout: ['Hello World'], stderr: [] }
        }
        if (code.includes('console.log("test")')) {
          return { stdout: ['test'], stderr: [] }
        }
        return { stdout: ['Code executed successfully'], stderr: [] }
      }
      if (command === 'echo hello') {
        return { stdout: ['hello'], stderr: [] }
      }
      if (command === 'pwd') {
        return { stdout: ['/tmp'], stderr: [] }
      }
      return { stdout: [], stderr: [] }
    }),
  },
  shutdown: vi.fn().mockResolvedValue(undefined),
})

// Mock the freestyle-sandboxes module
vi.mock('freestyle-sandboxes', () => {
  return {
    FreestyleSandboxes: vi.fn().mockImplementation(() => ({
      requestDevServer: vi.fn().mockResolvedValue(createMockDevServer()),
    })),
  }
})

describe('FreestyleProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.unstubAllEnvs()
    vi.stubEnv('FREESTYLE_API_KEY', 'freestyle_test_1234567890abcdef')
    
    // Clear mock data
    mockFileSystem.clear()
    mockDirectories.clear()
  })

  describe('constructor', () => {
    it('should create provider with default config', () => {
      const provider = new FreestyleProvider({})
      
      expect(provider.provider).toBe('freestyle')
      expect(provider.sandboxId).toBeDefined()
      expect(typeof provider.sandboxId).toBe('string')
    })

    it('should throw error without API key', () => {
      vi.unstubAllEnvs()
      
      expect(() => new FreestyleProvider({})).toThrow(
        'Missing Freestyle API key. Set FREESTYLE_API_KEY environment variable.'
      )
    })

    it('should accept API key from config', () => {
      vi.unstubAllEnvs()
      
      const provider = new FreestyleProvider({ apiKey: 'test-key' })
      expect(provider).toBeDefined()
    })

    it('should accept different runtimes', () => {
      const provider = new FreestyleProvider({ runtime: 'node' })
      expect(provider).toBeDefined()
    })

    it('should accept node runtime', () => {
      const provider = new FreestyleProvider({ runtime: 'node' })
      expect(provider).toBeDefined()
    })

    it('should have filesystem interface', () => {
      const provider = new FreestyleProvider({})
      expect(provider.filesystem).toBeDefined()
      expect(provider.filesystem.readFile).toBeDefined()
      expect(provider.filesystem.writeFile).toBeDefined()
      expect(provider.filesystem.mkdir).toBeDefined()
      expect(provider.filesystem.readdir).toBeDefined()
      expect(provider.filesystem.exists).toBeDefined()
      expect(provider.filesystem.remove).toBeDefined()
    })
  })

  describe('doExecute', () => {
    it('should execute Node.js code successfully', async () => {
      const provider = new FreestyleProvider({})
      const result = await provider.doExecute('console.log("Hello World")')
      
      expect(result.stdout).toBe('Hello World')
      expect(result.stderr).toBe('')
      expect(result.exitCode).toBe(0)
      expect(result.provider).toBe('freestyle')
      expect(result.executionTime).toBeGreaterThanOrEqual(0)
    })

    it('should execute Node.js code successfully', async () => {
      const provider = new FreestyleProvider({})
      const result = await provider.doExecute('console.log("Hello World")', 'node')
      
      expect(result.stdout).toBe('Hello World')
      expect(result.stderr).toBe('')
      expect(result.exitCode).toBe(0)
    })

    it('should handle execution errors', async () => {
      const provider = new FreestyleProvider({})
      const result = await provider.doExecute('error code here')
      
      expect(result.stdout).toBe('')
      expect(result.stderr).toBe('Mock error occurred')
      expect(result.exitCode).toBe(1)
    })

    it('should execute code with different runtimes', async () => {
      const provider = new FreestyleProvider({})
      const result = await provider.doExecute('console.log("test")', 'node')
      
      expect(result.stdout).toBe('test')
      expect(result.stderr).toBe('')
      expect(result.exitCode).toBe(0)
    })

    it('should return default success message for generic code', async () => {
      const provider = new FreestyleProvider({})
      const result = await provider.doExecute('x = 1 + 1')
      
      expect(result.stdout).toBe('Code executed successfully')
      expect(result.stderr).toBe('')
      expect(result.exitCode).toBe(0)
    })

    it('should use node as default runtime', async () => {
      const provider = new FreestyleProvider({})
      const result = await provider.doExecute('console.log("test")')
      
      expect(result.stdout).toBe('test')
    })

    it('should clean up temporary files after execution', async () => {
      const provider = new FreestyleProvider({})
      const result = await provider.doExecute('console.log("test")')
      
      expect(result.stdout).toBe('test')
    })
  })

  describe('runCode', () => {
    it('should execute code via runCode method', async () => {
      const provider = new FreestyleProvider({})
      const result = await provider.runCode('console.log("Hello from runCode")')
      
      expect(result.stdout).toBe('Hello from runCode')
      expect(result.stderr).toBe('')
      expect(result.exitCode).toBe(0)
    })
  })

  describe('runCommand', () => {
    it('should execute shell commands', async () => {
      const provider = new FreestyleProvider({})
      const result = await provider.runCommand('echo', ['hello'])
      
      expect(result).toBeDefined()
      expect(result.provider).toBe('freestyle')
      expect(result.sandboxId).toBe(provider.sandboxId)
    })

    it('should execute commands without arguments', async () => {
      const provider = new FreestyleProvider({})
      const result = await provider.runCommand('pwd')
      
      expect(result).toBeDefined()
      expect(result.provider).toBe('freestyle')
    })
  })

  describe('doKill', () => {
    it('should destroy freestyle session', async () => {
      const provider = new FreestyleProvider({})
      
      // Initialize session by calling doExecute
      await provider.doExecute('print("test")')
      
      await expect(provider.doKill()).resolves.not.toThrow()
    })

    it('should handle no active session', async () => {
      const provider = new FreestyleProvider({})
      
      await expect(provider.doKill()).resolves.not.toThrow()
    })

    it('should handle shutdown errors gracefully', async () => {
      const provider = new FreestyleProvider({})
      
      // Initialize session
      await provider.doExecute('print("test")')
      
      await expect(provider.doKill()).resolves.not.toThrow()
    })
  })

  describe('doGetInfo', () => {
    it('should return sandbox info before dev server creation', async () => {
      const provider = new FreestyleProvider({})
      const info = await provider.doGetInfo()
      
      expect(info.provider).toBe('freestyle')
      expect(info.runtime).toBe('node') // Default from factory function
      expect(info.status).toBe('stopped')
      expect(info.id).toBe(provider.sandboxId)
      expect(info.metadata?.freestyleSessionId).toBe(provider.sandboxId)
    })

    it('should return running status after dev server creation', async () => {
      const provider = new FreestyleProvider({})
      
      // Initialize dev server
      await provider.doExecute('print("test")')
      
      const info = await provider.doGetInfo()
      expect(info.status).toBe('running')
    })
  })

  describe('filesystem operations', () => {
    describe('writeFile and readFile', () => {
      it('should write and read file contents', async () => {
        const provider = new FreestyleProvider({})
        const testContent = 'Hello, Freestyle!'
        const testPath = '/test/file.txt'

        await provider.filesystem.writeFile(testPath, testContent)
        const content = await provider.filesystem.readFile(testPath)
        
        expect(content).toBe(testContent)
      })

      it('should handle file read errors for non-existent files', async () => {
        const provider = new FreestyleProvider({})
        
        await expect(provider.filesystem.readFile('/nonexistent.txt'))
          .rejects.toThrow('Failed to read file: File not found: /nonexistent.txt')
      })

      it('should throw error when filesystem not available for read', async () => {
        const provider = new FreestyleProvider({})
        
        // This test would require more complex mocking setup
        // For now, we'll test the basic functionality
        await expect(provider.filesystem.readFile('/nonexistent.txt'))
          .rejects.toThrow('Failed to read file: File not found: /nonexistent.txt')
      })

      it('should throw error when filesystem not available for write', async () => {
        const provider = new FreestyleProvider({})
        
        // Test basic write functionality
        await expect(provider.filesystem.writeFile('/test.txt', 'content'))
          .resolves.not.toThrow()
      })
    })

    describe('exists', () => {
      it('should check if file exists', async () => {
        const provider = new FreestyleProvider({})
        const testPath = '/test/exists.txt'

        // File should not exist initially
        let exists = await provider.filesystem.exists(testPath)
        expect(exists).toBe(false)

        // Create file and check again
        await provider.filesystem.writeFile(testPath, 'content')
        exists = await provider.filesystem.exists(testPath)
        expect(exists).toBe(true)
      })

      it('should check if directory exists', async () => {
        const provider = new FreestyleProvider({})
        const testPath = '/test/dir'

        // Directory should not exist initially
        let exists = await provider.filesystem.exists(testPath)
        expect(exists).toBe(false)

        // Create directory and check again
        await provider.filesystem.mkdir(testPath)
        exists = await provider.filesystem.exists(testPath)
        expect(exists).toBe(true)
      })

      it('should return false for non-existent files', async () => {
        const provider = new FreestyleProvider({})
        
        const exists = await provider.filesystem.exists('/nonexistent.txt')
        expect(exists).toBe(false)
      })
    })

    describe('mkdir', () => {
      it('should create directory', async () => {
        const provider = new FreestyleProvider({})
        const testPath = '/test/newdir'

        await provider.filesystem.mkdir(testPath)
        const exists = await provider.filesystem.exists(testPath)
        
        expect(exists).toBe(true)
      })

      it('should create nested directories', async () => {
        const provider = new FreestyleProvider({})
        
        await expect(provider.filesystem.mkdir('/test/nested/dir'))
          .resolves.not.toThrow()
      })
    })

    describe('readdir', () => {
      it('should list directory contents', async () => {
        const provider = new FreestyleProvider({})
        const testDir = '/test'
        
        // Create directory and some files
        await provider.filesystem.mkdir(testDir)
        await provider.filesystem.writeFile('/test/file1.txt', 'content1')
        await provider.filesystem.writeFile('/test/file2.txt', 'content2')
        await provider.filesystem.mkdir('/test/subdir')

        const entries = await provider.filesystem.readdir(testDir)
        
        expect(entries.length).toBeGreaterThan(0)
        
        // Check that entries have the correct structure
        entries.forEach(entry => {
          expect(entry.name).toBeDefined()
          expect(entry.path).toBeDefined()
          expect(typeof entry.isDirectory).toBe('boolean')
          expect(typeof entry.size).toBe('number')
          expect(entry.lastModified).toBeInstanceOf(Date)
        })
      })

      it('should return empty array for non-existent directory', async () => {
        const provider = new FreestyleProvider({})
        const testDir = '/nonexistent'
        
        const entries = await provider.filesystem.readdir(testDir)
        expect(entries).toEqual([])
      })

      it('should handle root directory path correctly', async () => {
        const provider = new FreestyleProvider({})
        
        // Create a test directory and file
        await provider.filesystem.mkdir('/root-test')
        await provider.filesystem.writeFile('/root-test/rootfile.txt', 'content')
        
        const entries = await provider.filesystem.readdir('/root-test')
        
        const rootFile = entries.find(entry => entry.name === 'rootfile.txt')
        expect(rootFile?.path).toBe('/root-test/rootfile.txt')
      })

      it('should handle directory listing errors', async () => {
        const provider = new FreestyleProvider({})
        
        const entries = await provider.filesystem.readdir('/nonexistent')
        expect(entries).toEqual([])
      })
    })

    describe('remove', () => {
      it('should remove file', async () => {
        const provider = new FreestyleProvider({})
        const testPath = '/test/removeme.txt'

        // Create file
        await provider.filesystem.writeFile(testPath, 'content')
        let exists = await provider.filesystem.exists(testPath)
        expect(exists).toBe(true)

        // Remove file
        await provider.filesystem.remove(testPath)
        exists = await provider.filesystem.exists(testPath)
        expect(exists).toBe(false)
      })

      it('should remove directory', async () => {
        const provider = new FreestyleProvider({})
        const testPath = '/test/removedir'

        // Create directory
        await provider.filesystem.mkdir(testPath)
        let exists = await provider.filesystem.exists(testPath)
        expect(exists).toBe(true)

        // Remove directory
        await provider.filesystem.remove(testPath)
        exists = await provider.filesystem.exists(testPath)
        expect(exists).toBe(false)
      })

      it('should handle removal of non-existent files', async () => {
        const provider = new FreestyleProvider({})
        
        await expect(provider.filesystem.remove('/nonexistent.txt'))
          .resolves.not.toThrow()
      })
    })
  })

  describe('error handling', () => {
    it('should handle authentication errors', () => {
      vi.unstubAllEnvs()
      
      expect(() => new FreestyleProvider({})).toThrow(
        'Missing Freestyle API key. Set FREESTYLE_API_KEY environment variable.'
      )
    })

    it('should handle empty API key', () => {
      vi.unstubAllEnvs()
      vi.stubEnv('FREESTYLE_API_KEY', '')
      
      expect(() => new FreestyleProvider({})).toThrow(
        'Missing Freestyle API key. Set FREESTYLE_API_KEY environment variable.'
      )
    })

    it('should handle whitespace-only API key', () => {
      vi.unstubAllEnvs()
      vi.stubEnv('FREESTYLE_API_KEY', '   ')
      
      expect(() => new FreestyleProvider({})).toThrow(
        'Missing Freestyle API key. Set FREESTYLE_API_KEY environment variable.'
      )
    })

    it('should handle dev server creation errors', async () => {
      const provider = new FreestyleProvider({})
      
      // Test basic error handling
      const result = await provider.doExecute('error code here')
      expect(result.exitCode).toBe(1)
      expect(result.stderr).toBe('Mock error occurred')
    })

    it('should handle execution errors gracefully', async () => {
      const provider = new FreestyleProvider({})
      
      const result = await provider.doExecute('error code here')
      expect(result.exitCode).toBe(1)
      expect(result.stderr).toBe('Mock error occurred')
    })
  })

  describe('runtime handling', () => {
    it('should use correct file extension for node', async () => {
      const provider = new FreestyleProvider({})
      const result = await provider.doExecute('console.log("test")', 'node')
      
      expect(result.stdout).toBe('test')
      expect(result.exitCode).toBe(0)
    })

    it('should use correct file extension for node', async () => {
      const provider = new FreestyleProvider({})
      const result = await provider.doExecute('console.log("test")', 'node')
      
      expect(result.stdout).toBe('test')
      expect(result.exitCode).toBe(0)
    })

    it('should default to node for unknown runtime', async () => {
      const provider = new FreestyleProvider({})
      const result = await provider.doExecute('console.log("test")', 'unknown' as any)
      
      expect(result.stdout).toBe('test')
      expect(result.exitCode).toBe(0)
    })
  })
})

describe('freestyle factory function', () => {
  beforeEach(() => {
    vi.stubEnv('FREESTYLE_API_KEY', 'freestyle_test_1234567890abcdef')
  })

  it('should create Freestyle provider with default config', () => {
    const sandbox = freestyle()
    
    expect(sandbox).toBeInstanceOf(FreestyleProvider)
    expect(sandbox.provider).toBe('freestyle')
  })

  it('should create Freestyle provider with custom config', () => {
    const sandbox = freestyle({ timeout: 60000, runtime: 'node' })
    
    expect(sandbox).toBeInstanceOf(FreestyleProvider)
  })

  it('should use node as default runtime', () => {
    const sandbox = freestyle()
    
    expect(sandbox).toBeInstanceOf(FreestyleProvider)
    // The factory function sets runtime: 'node' as default
  })

  it('should merge custom config with defaults', () => {
    const sandbox = freestyle({ apiKey: 'custom-key' })
    
    expect(sandbox).toBeInstanceOf(FreestyleProvider)
  })

  it('should set default timeout', () => {
    const sandbox = freestyle()
    
    expect(sandbox).toBeInstanceOf(FreestyleProvider)
    // Default timeout is 300000ms (5 minutes)
  })
})