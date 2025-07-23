import type { SandboxFileSystem } from 'computesdk'

export interface RuntimeExecutionResult {
  stdout: string
  stderr: string
  exitCode: number
  executionTime: number
}

export interface RuntimeContext {
  filesystem: SandboxFileSystem
  cwd: string
  env: Record<string, string>
}

export interface CodeRuntime {
  readonly name: string
  readonly version: string
  
  initialize(context: RuntimeContext): Promise<void>
  execute(code: string): Promise<RuntimeExecutionResult>
  cleanup(): Promise<void>
  
  // Runtime-specific capabilities
  isReady(): boolean
  getLoadedPackages(): string[]
}