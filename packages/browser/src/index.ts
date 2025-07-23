import { makePersistedAdapter } from '@livestore/adapter-web'
import type {
  ExecutionResult,
  FilesystemComputeSpecification,
  Runtime,
  SandboxInfo,
  SandboxFileSystem,
  FileEntry,
} from 'computesdk'
import { ExecutionError, TimeoutError } from 'computesdk'
import { schema } from './schema.js'
import { RuntimeManager } from './runtime/manager.js'
import { ProcessManager } from './process/manager.js'
import type { ProcessId, ProcessOptions, ProcessInfo, ProcessResult } from './process/types.js'
import { TerminalManager } from './terminal/manager.js'
import type { Terminal } from './terminal/terminal.js'

// Worker imports - these will be handled by the bundler in browser environments
// TODO: Enable when using in a proper browser bundler (Vite, Webpack, etc.)
// import LiveStoreWorker from './worker?worker'
// import LiveStoreSharedWorker from '@livestore/adapter-web/shared-worker?sharedworker'

// For now, use undefined to trigger helpful error messages
const LiveStoreWorker: any = undefined
const LiveStoreSharedWorker: any = undefined

export interface BrowserSandboxOptions {
  /**
   * Reset persistence on initialization (useful for development)
   */
  resetPersistence?: boolean
  
  /**
   * Working directory for the sandbox
   */
  cwd?: string
}



// Persistent filesystem with cross-tab sync and OPFS storage
class PersistentFileSystem implements SandboxFileSystem {
  constructor(private store: any) {}

  async readFile(path: string): Promise<string> {
    const file = await this.store.queryDb(() => 
      this.store.state.tables.files.findFirst({ 
        where: { path, deletedAt: null, isDirectory: false } 
      })
    )
    
    if (!file) {
      throw new Error(`File not found: ${path}`)
    }
    
    return file.content
  }

  async writeFile(path: string, content: string): Promise<void> {
    // Ensure parent directory exists
    const parentPath = path.substring(0, path.lastIndexOf('/')) || '/'
    if (parentPath !== '/' && !(await this.exists(parentPath))) {
      await this.mkdir(parentPath)
    }
    
    const existingFile = await this.store.queryDb(() => 
      this.store.state.tables.files.findFirst({ 
        where: { path, deletedAt: null } 
      })
    )
    
    const now = new Date()
    const size = new TextEncoder().encode(content).length
    
    if (existingFile) {
      // Update existing file
      await this.store.commitEvent('fileWritten', {
        path,
        content,
        size,
        modifiedAt: now,
      })
    } else {
      // Create new file
      await this.store.commitEvent('fileCreated', {
        path,
        content,
        mimeType: this.getMimeType(path),
        size,
        createdAt: now,
      })
    }
  }

  async mkdir(path: string): Promise<void> {
    const existing = await this.store.queryDb(() => 
      this.store.state.tables.files.findFirst({ 
        where: { path, deletedAt: null } 
      })
    )
    
    if (existing) {
      if (!existing.isDirectory) {
        throw new Error(`Path exists but is not a directory: ${path}`)
      }
      return
    }
    
    // Ensure parent directory exists
    const parentPath = path.substring(0, path.lastIndexOf('/')) || '/'
    if (parentPath !== '/' && !(await this.exists(parentPath))) {
      await this.mkdir(parentPath)
    }
    
    await this.store.commitEvent('directoryCreated', {
      path,
      createdAt: new Date(),
    })
  }

  async readdir(path: string): Promise<FileEntry[]> {
    const dir = await this.store.queryDb(() => 
      this.store.state.tables.files.findFirst({ 
        where: { path, deletedAt: null, isDirectory: true } 
      })
    )
    
    if (!dir) {
      throw new Error(`Directory not found: ${path}`)
    }
    
    const files = await this.store.queryDb(() => 
      this.store.state.tables.files.findMany({ 
        where: { parentPath: path, deletedAt: null } 
      })
    )
    
    return files.map((file: any) => ({
      name: file.name,
      path: file.path,
      isDirectory: file.isDirectory,
      size: file.size,
      lastModified: file.modifiedAt || file.createdAt,
    }))
  }

  async exists(path: string): Promise<boolean> {
    const file = await this.store.queryDb(() => 
      this.store.state.tables.files.findFirst({ 
        where: { path, deletedAt: null } 
      })
    )
    
    return !!file
  }

  async remove(path: string): Promise<void> {
    const file = await this.store.queryDb(() => 
      this.store.state.tables.files.findFirst({ 
        where: { path, deletedAt: null } 
      })
    )
    
    if (!file) {
      throw new Error(`Path does not exist: ${path}`)
    }
    
    if (file.isDirectory) {
      await this.store.commitEvent('directoryDeleted', {
        path,
        deletedAt: new Date(),
      })
    } else {
      await this.store.commitEvent('fileDeleted', {
        path,
        deletedAt: new Date(),
      })
    }
  }

  private getMimeType(path: string): string | undefined {
    const ext = path.split('.').pop()?.toLowerCase()
    const mimeTypes: Record<string, string> = {
      'js': 'application/javascript',
      'ts': 'application/typescript',
      'json': 'application/json',
      'html': 'text/html',
      'css': 'text/css',
      'md': 'text/markdown',
      'txt': 'text/plain',
    }
    return mimeTypes[ext || '']
  }
}

export class BrowserSandbox implements FilesystemComputeSpecification {
  public readonly specificationVersion = 'v1' as const
  public readonly provider = 'browser'
  public readonly sandboxId: string
  public filesystem: SandboxFileSystem

  private adapter: any
  private store: any
  private cwd: string
  private runtimeManager: RuntimeManager
  private processManager: ProcessManager
  public terminal: TerminalManager

  constructor(options: BrowserSandboxOptions = {}) {
    this.sandboxId = `browser_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`
    this.cwd = options.cwd || '/'
    
    // Initialize LiveStore adapter
    this.adapter = makePersistedAdapter({
      storage: { type: 'opfs' },
      worker: LiveStoreWorker,
      sharedWorker: LiveStoreSharedWorker,
      resetPersistence: options.resetPersistence,
    })
    
    // Initialize runtime manager
    this.runtimeManager = new RuntimeManager()
    
    // Initialize process manager
    this.processManager = new ProcessManager(this.runtimeManager)
    
    // Filesystem will be initialized after store is ready
    this.filesystem = null as any // Temporary until initialize() is called
    this.terminal = null as any // Temporary until initialize() is called
  }

  async initialize(): Promise<void> {
    try {
      // Initialize persistent storage
      this.store = await this.adapter.createStore(schema)
      this.filesystem = new PersistentFileSystem(this.store)
      
      // Initialize runtime manager with context
      await this.runtimeManager.initialize({
        filesystem: this.filesystem,
        cwd: this.cwd,
        env: {
          NODE_ENV: 'development',
          PATH: '/usr/local/bin:/usr/bin:/bin',
          HOME: '/',
          USER: 'browser',
          ...process?.env // Include any existing env vars if available
        }
      })
      
      // Create root directory if it doesn't exist
      if (!(await this.filesystem.exists('/'))) {
        await this.filesystem.mkdir('/')
      }
      
      // Initialize terminal manager with filesystem and runtime manager
      this.terminal = new TerminalManager(this.filesystem, this.runtimeManager)
    } catch (error) {
      // Provide helpful error message for setup issues
      const errorMessage = `
Failed to initialize @computesdk/browser with persistent filesystem.

This package requires a browser environment with:
1. Web Workers support
2. Origin Private File System (OPFS) support  
3. A bundler that supports worker imports (Vite, Webpack 5+)

Common solutions:
- Use Vite: Add "?worker" import support
- Use Webpack 5+: Configure worker-loader
- Check browser compatibility: Chrome 86+, Firefox 96+, Safari 15.2+

For testing in Node.js, consider using a different ComputeSDK provider.

Original error: ${error instanceof Error ? error.message : String(error)}
      `.trim()
      
      throw new Error(errorMessage)
    }
  }

  // Core ComputeSpecification methods
  async doExecute(code: string, runtime: Runtime = 'node'): Promise<ExecutionResult> {
    try {
      // Use the new runtime manager
      const result = await this.runtimeManager.execute(code, runtime)
      
      return {
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.exitCode,
        executionTime: result.executionTime,
        sandboxId: this.sandboxId,
        provider: this.provider,
      }
    } catch (error) {
      if (error instanceof ExecutionError || error instanceof TimeoutError) {
        throw error
      }
      throw new ExecutionError(`Execution failed: ${error}`, this.provider, 1, this.sandboxId)
    }
  }

  async runCode(code: string, runtime: Runtime = 'node'): Promise<ExecutionResult> {
    return this.doExecute(code, runtime)
  }

  async runCommand(commandLine: string): Promise<ExecutionResult> {
    const startTime = Date.now()
    
    try {
      // Parse command line (simple split for now, could be enhanced)
      const parts = commandLine.trim().split(/\s+/)
      if (parts.length === 0 || parts[0] === '') {
        const executionTime = Date.now() - startTime
        return {
          stdout: '',
          stderr: 'No command provided\n',
          exitCode: 1,
          executionTime,
          sandboxId: this.sandboxId,
          provider: this.provider,
        }
      }

      const command = parts[0]
      const args = parts.slice(1)
      
      // Import shell commands
      const { getCommand } = await import('./shell/commands/index.js')
      const cmd = getCommand(command)
      
      if (!cmd) {
        const executionTime = Date.now() - startTime
        return {
          stdout: '',
          stderr: `${command}: command not found\n`,
          exitCode: 127,
          executionTime,
          sandboxId: this.sandboxId,
          provider: this.provider,
        }
      }

      const result = await cmd.execute(args, {
        cwd: this.cwd,
        env: {
          NODE_ENV: 'development',
          PATH: '/usr/local/bin:/usr/bin:/bin',
          HOME: '/',
          USER: 'browser',
          PWD: this.cwd,
        },
        filesystem: this.filesystem,
        runtimeManager: this.runtimeManager
      })

      const executionTime = Date.now() - startTime
      
      return {
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.exitCode,
        executionTime,
        sandboxId: this.sandboxId,
        provider: this.provider,
      }
    } catch (error) {
      const executionTime = Date.now() - startTime
      return {
        stdout: '',
        stderr: `Error executing command: ${error}\n`,
        exitCode: 1,
        executionTime,
        sandboxId: this.sandboxId,
        provider: this.provider,
      }
    }
  }

  async doKill(): Promise<void> {
    // For browser implementation, we don't have long-running processes to kill
    // This is a no-op for now
  }

  async doGetInfo(): Promise<SandboxInfo> {
    return {
      id: this.sandboxId,
      status: 'running',
      provider: this.provider,
      runtime: 'node',
      createdAt: new Date(),
      timeout: 30000,
    }
  }



  // Add new methods for the mini OS features
  async installPackage(packageName: string, runtime: Runtime = 'python'): Promise<void> {
    try {
      await this.runtimeManager.installPackage(packageName, runtime)
    } catch (error) {
      throw new ExecutionError(`Failed to install package ${packageName}: ${error}`, this.provider, 1, this.sandboxId)
    }
  }

  getAvailableRuntimes(): Runtime[] {
    return this.runtimeManager.getAvailableRuntimes()
  }

  getRuntimeInfo(runtime: Runtime): { name: string; version: string; ready: boolean } | null {
    return this.runtimeManager.getRuntimeInfo(runtime)
  }

  getLoadedPackages(runtime: Runtime): string[] {
    return this.runtimeManager.getLoadedPackages(runtime)
  }

  // Process Management Methods
  async spawn(code: string, options: ProcessOptions): Promise<ProcessId> {
    return this.processManager.spawn(code, options)
  }



  async killProcess(pid: ProcessId, signal?: string): Promise<void> {
    return this.processManager.kill(pid, signal)
  }

  async suspendProcess(pid: ProcessId): Promise<void> {
    return this.processManager.suspend(pid)
  }

  async resumeProcess(pid: ProcessId): Promise<void> {
    return this.processManager.resume(pid)
  }

  async waitForProcess(pid: ProcessId): Promise<ProcessResult> {
    return this.processManager.wait(pid)
  }

  getProcess(pid: ProcessId): ProcessInfo | null {
    return this.processManager.getProcess(pid)
  }

  listProcesses(): ProcessInfo[] {
    return this.processManager.listProcesses()
  }

  getRunningProcesses(): ProcessInfo[] {
    return this.processManager.getRunningProcesses()
  }

  async foregroundProcess(pid: ProcessId): Promise<void> {
    return this.processManager.foreground(pid)
  }

  async backgroundProcess(pid: ProcessId): Promise<void> {
    return this.processManager.background(pid)
  }

  getCurrentForegroundProcess(): ProcessInfo | null {
    return this.processManager.getCurrentForegroundProcess()
  }

  getBackgroundProcesses(): ProcessInfo[] {
    return this.processManager.getBackgroundProcesses()
  }

  getProcessStats() {
    return this.processManager.getProcessStats()
  }

  // Enhanced runCode method that creates a process
  async runCodeAsProcess(code: string, runtime: Runtime = 'node', background: boolean = false): Promise<ProcessId> {
    return this.spawn(code, {
      runtime,
      background,
      cwd: this.cwd,
      env: {
        NODE_ENV: 'development',
        PATH: '/usr/local/bin:/usr/bin:/bin',
        HOME: '/',
        USER: 'browser'
      }
    })
  }
}

// Factory function following the pattern of other providers
export function browser(options: BrowserSandboxOptions = {}): BrowserSandbox {
  return new BrowserSandbox(options)
}

// Default export
export default browser