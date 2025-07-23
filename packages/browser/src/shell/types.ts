// Event emitter interface for browser compatibility
export interface EventEmitterLike {
  on(event: string, listener: (...args: any[]) => void): this
  emit(event: string, ...args: any[]): boolean
  removeListener(event: string, listener: (...args: any[]) => void): this
  off(event: string, listener: (...args: any[]) => void): this
}

export interface ShellProcess extends EventEmitterLike {
  pid: string
  command: string
  args: string[]
  
  // Node.js-like streams
  stdin: ShellStream
  stdout: ShellStream  
  stderr: ShellStream
  
  // Process control
  kill(signal?: string): void
  
  // Status
  exitCode: number | null
  killed: boolean
}

export interface ShellStream extends EventEmitterLike {
  write(chunk: string): boolean
  end(): void
  readable: boolean
  writable: boolean
}

export interface ShellCommand {
  name: string
  description: string
  execute(args: string[], options: ShellCommandOptions): Promise<ShellCommandResult>
}

export interface ShellCommandOptions {
  cwd: string
  env: Record<string, string>
  filesystem: any // FilesystemComputeSpecification
  stdin?: string // Input from previous command in pipeline
  runtimeManager?: any // RuntimeManager for executing scripts
}

export interface ShellCommandResult {
  stdout: string
  stderr: string
  exitCode: number
  newCwd?: string // For cd command to update working directory
}

export interface ShellEnvironment {
  cwd: string
  env: Record<string, string>
  path: string[]
}