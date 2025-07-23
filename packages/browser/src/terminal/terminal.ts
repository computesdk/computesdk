import { EventEmitter } from '../utils/events.js'
import { getCommand } from '../shell/commands/index.js'
import type { ShellCommandOptions } from '../shell/types.js'

export interface Terminal {
  write(command: string): void
  resize(cols: number, rows: number): void
  kill(signal?: string): void
  destroy(): void
  on(event: 'data', listener: (data: string) => void): this
  on(event: 'error', listener: (error: string) => void): this
  on(event: 'exit', listener: (exitInfo: { exitCode: number; signal?: string }) => void): this
  on(event: string, listener: (...args: any[]) => void): this
  readonly cols: number
  readonly rows: number
}

export class TerminalSession extends EventEmitter implements Terminal {
  private filesystem: any
  private runtimeManager: any
  private cwd: string = '/'
  private env: Record<string, string>
  private destroyed: boolean = false
  private _cols: number = 80
  private _rows: number = 24

  constructor(filesystem: any, runtimeManager: any, initialCwd: string = '/') {
    super()
    this.filesystem = filesystem
    this.runtimeManager = runtimeManager
    this.cwd = initialCwd
    this.env = {
      PATH: '/usr/local/bin:/usr/bin:/bin',
      HOME: '/',
      USER: 'browser',
      PWD: initialCwd,
      COLUMNS: '80',
      LINES: '24',
      TERM: 'xterm-256color',
    }
  }

  get cols(): number {
    return this._cols
  }

  get rows(): number {
    return this._rows
  }

  resize(cols: number, rows: number): void {
    this._cols = cols
    this._rows = rows
    this.env.COLUMNS = cols.toString()
    this.env.LINES = rows.toString()
  }

  kill(signal?: string): void {
    // For now, just destroy the terminal
    // In a real implementation, this would send a signal to running processes
    this.emit('exit', { exitCode: signal === 'SIGKILL' ? 137 : 143, signal })
    this.destroy()
  }

  write(commandLine: string): void {
    if (this.destroyed) {
      this.emit('error', 'Terminal session has been destroyed')
      return
    }

    // Parse command line with proper quote handling
    const parts = this.parseCommandLine(commandLine.trim())
    if (parts.length === 0 || parts[0] === '') {
      return
    }

    const command = parts[0]
    const args = parts.slice(1)

    // Execute command asynchronously
    this.executeCommand(command, args)
  }

  private parseCommandLine(commandLine: string): string[] {
    const parts: string[] = []
    let current = ''
    let inQuotes = false
    let quoteChar = ''
    
    for (let i = 0; i < commandLine.length; i++) {
      const char = commandLine[i]
      
      if (!inQuotes && (char === '"' || char === "'")) {
        inQuotes = true
        quoteChar = char
      } else if (inQuotes && char === quoteChar) {
        inQuotes = false
        quoteChar = ''
      } else if (!inQuotes && /\s/.test(char)) {
        if (current) {
          parts.push(current)
          current = ''
        }
      } else {
        current += char
      }
    }
    
    if (current) {
      parts.push(current)
    }
    
    return parts
  }

  private async executeCommand(command: string, args: string[]): Promise<void> {
    try {
      // Handle built-in commands first
      if (command === 'cd') {
        await this.handleCd(args)
        return
      }

      if (command === 'export') {
        this.handleExport(args)
        return
      }

      // Get shell command
      const cmd = getCommand(command)
      
      if (!cmd) {
        this.emit('error', `${command}: command not found\n`)
        return
      }

      const options: ShellCommandOptions = {
        cwd: this.cwd,
        env: this.env,
        filesystem: this.filesystem,
        runtimeManager: this.runtimeManager
      }

      const result = await cmd.execute(args, options)

      // Emit output
      if (result.stdout) {
        this.emit('data', result.stdout)
      }
      if (result.stderr) {
        this.emit('error', result.stderr)
      }

      // Handle directory changes
      if (result.newCwd) {
        this.cwd = result.newCwd
        this.env.PWD = result.newCwd
      }

    } catch (error) {
      this.emit('error', `${command}: ${error instanceof Error ? error.message : String(error)}\n`)
    }
  }

  private async handleCd(args: string[]): Promise<void> {
    const targetPath = args[0] || this.env.HOME || '/'
    
    try {
      // Resolve relative paths using proper path normalization
      let newPath: string
      if (targetPath.startsWith('/')) {
        newPath = targetPath
      } else {
        // Handle relative paths by combining with current directory
        newPath = this.cwd === '/' ? `/${targetPath}` : `${this.cwd}/${targetPath}`
      }

      // Normalize the path (handle .., ., and multiple slashes)
      newPath = this.normalizePath(newPath)

      // Check if directory exists
      const exists = await this.filesystem.exists(newPath)
      if (!exists) {
        this.emit('error', `cd: ${targetPath}: No such file or directory\n`)
        return
      }

      // Update current directory
      this.cwd = newPath
      this.env.PWD = newPath

    } catch (error) {
      this.emit('error', `cd: ${error instanceof Error ? error.message : String(error)}\n`)
    }
  }

  private normalizePath(path: string): string {
    if (!path.startsWith('/')) {
      path = '/' + path
    }
    
    // Remove double slashes and empty components
    const parts = path.split('/').filter(part => part !== '' && part !== '.')
    const normalized: string[] = []
    
    for (const part of parts) {
      if (part === '..') {
        normalized.pop()
      } else {
        normalized.push(part)
      }
    }
    
    return '/' + normalized.join('/')
  }

  private handleExport(args: string[]): void {
    if (args.length === 0) {
      // Show all environment variables
      const envOutput = Object.entries(this.env)
        .map(([key, value]) => `export ${key}="${value}"`)
        .join('\n') + '\n'
      this.emit('data', envOutput)
      return
    }

    for (const arg of args) {
      const [key, ...valueParts] = arg.split('=')
      if (valueParts.length > 0) {
        const value = valueParts.join('=').replace(/^["']|["']$/g, '') // Remove quotes
        this.env[key] = value
      }
    }
  }

  destroy(): void {
    this.destroyed = true
    this.removeAllListeners()
  }

  // Getters for current state
  getCwd(): string {
    return this.cwd
  }

  getEnv(): Record<string, string> {
    return { ...this.env }
  }
}