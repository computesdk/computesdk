import { describe, it, expect, beforeEach } from 'vitest'
import { browser, BrowserSandbox } from '../index.js'
import { TestFileSystem } from './test-filesystem.js'

describe('BrowserSandbox', () => {
  let sandbox: BrowserSandbox

  beforeEach(async () => {
    sandbox = browser({ resetPersistence: true })
    
    // Mock the filesystem for testing since LiveStore won't work in Node.js
    sandbox.filesystem = new TestFileSystem()
    
    // Mock the store for command execution tests
    ;(sandbox as any).store = null // No LiveStore in tests
  })

  describe('Basic functionality', () => {
    it('should create a sandbox with correct properties', () => {
      expect(sandbox.provider).toBe('browser')
      expect(sandbox.specificationVersion).toBe('v1')
      expect(sandbox.sandboxId).toMatch(/^browser_\d+_[a-z0-9]+$/)
    })

    it('should have filesystem interface', () => {
      expect(sandbox.filesystem).toBeDefined()
      expect(typeof sandbox.filesystem.readFile).toBe('function')
      expect(typeof sandbox.filesystem.writeFile).toBe('function')
      expect(typeof sandbox.filesystem.mkdir).toBe('function')
      expect(typeof sandbox.filesystem.readdir).toBe('function')
      expect(typeof sandbox.filesystem.exists).toBe('function')
      expect(typeof sandbox.filesystem.remove).toBe('function')
    })
  })

  describe('Filesystem operations', () => {
    it('should write and read files', async () => {
      const content = 'Hello, World!'
      const path = '/test.txt'

      await sandbox.filesystem.writeFile(path, content)
      const readContent = await sandbox.filesystem.readFile(path)

      expect(readContent).toBe(content)
    })

    it('should create and list directories', async () => {
      const dirPath = '/testdir'
      const filePath = '/testdir/file.txt'

      await sandbox.filesystem.mkdir(dirPath)
      await sandbox.filesystem.writeFile(filePath, 'test content')

      const entries = await sandbox.filesystem.readdir(dirPath)
      expect(entries).toHaveLength(1)
      expect(entries[0].name).toBe('file.txt')
      expect(entries[0].isDirectory).toBe(false)
    })

    it('should check file existence', async () => {
      const path = '/exists.txt'

      expect(await sandbox.filesystem.exists(path)).toBe(false)

      await sandbox.filesystem.writeFile(path, 'content')
      expect(await sandbox.filesystem.exists(path)).toBe(true)
    })

    it('should remove files', async () => {
      const path = '/remove.txt'

      await sandbox.filesystem.writeFile(path, 'content')
      expect(await sandbox.filesystem.exists(path)).toBe(true)

      await sandbox.filesystem.remove(path)
      expect(await sandbox.filesystem.exists(path)).toBe(false)
    })
  })

  // Note: Runtime execution tests (runCode) have been moved to integration tests
  // See src/__tests__/integration/runtime.test.ts for QuickJS/Pyodide testing

  describe('Command execution', () => {
    it('should execute echo command', async () => {
      const result = await sandbox.runCommand('echo Hello World')

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toBe('Hello World\n')
      expect(result.stderr).toBe('')
    })

    it('should execute pwd command', async () => {
      const result = await sandbox.runCommand('pwd')

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toBe('/\n')
      expect(result.stderr).toBe('')
    })

    it('should execute ls command', async () => {
      // Create some files first
      await sandbox.filesystem.writeFile('/file1.txt', 'content1')
      await sandbox.filesystem.writeFile('/file2.txt', 'content2')

      const result = await sandbox.runCommand('ls')

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('file1.txt')
      expect(result.stdout).toContain('file2.txt')
    })

    it('should execute ls with arguments', async () => {
      // Create some files first
      await sandbox.filesystem.writeFile('/file1.txt', 'content1')
      
      const result = await sandbox.runCommand('ls -la')

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('file1.txt')
    })

    it('should handle unknown commands', async () => {
      const result = await sandbox.runCommand('unknowncommand')

      expect(result.exitCode).toBe(127)
      expect(result.stderr).toContain('command not found')
    })
  })

  describe('Sandbox info', () => {
    it('should return correct sandbox info', async () => {
      const info = await sandbox.doGetInfo()

      expect(info.id).toBe(sandbox.sandboxId)
      expect(info.provider).toBe('browser')
      expect(info.runtime).toBe('node')
      expect(info.status).toBe('running')
      expect(info.timeout).toBe(30000)
      expect(info.createdAt).toBeInstanceOf(Date)
    })
  })
})