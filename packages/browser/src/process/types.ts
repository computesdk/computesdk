import type { Runtime } from 'computesdk'

export type ProcessId = string
export type ProcessStatus = 'created' | 'running' | 'suspended' | 'completed' | 'failed' | 'killed'
export type ProcessPriority = 'low' | 'normal' | 'high'

export interface ProcessOptions {
  runtime: Runtime
  cwd?: string
  env?: Record<string, string>
  priority?: ProcessPriority
  background?: boolean
  timeout?: number
  stdin?: string
  args?: string[]
}

export interface ProcessInfo {
  pid: ProcessId
  name: string
  status: ProcessStatus
  runtime: Runtime
  cwd: string
  env: Record<string, string>
  priority: ProcessPriority
  background: boolean
  
  // Timing
  createdAt: Date
  startedAt?: Date
  completedAt?: Date
  
  // Resources
  executionTime: number
  memoryUsage?: number
  
  // I/O
  stdin: string
  stdout: string
  stderr: string
  exitCode?: number
  
  // Relationships
  parentPid?: ProcessId
  childPids: ProcessId[]
}

export interface ProcessResult {
  pid: ProcessId
  exitCode: number
  stdout: string
  stderr: string
  executionTime: number
  status: ProcessStatus
}

export interface ProcessEvent {
  type: 'created' | 'started' | 'output' | 'error' | 'completed' | 'killed'
  pid: ProcessId
  timestamp: Date
  data?: any
}

export interface ProcessMessage {
  from: ProcessId
  to: ProcessId
  type: 'signal' | 'data' | 'request' | 'response'
  payload: any
  timestamp: Date
}

export interface IProcessManager {
  // Process lifecycle
  spawn(code: string, options: ProcessOptions): Promise<ProcessId>
  kill(pid: ProcessId, signal?: string): Promise<void>
  suspend(pid: ProcessId): Promise<void>
  resume(pid: ProcessId): Promise<void>
  wait(pid: ProcessId): Promise<ProcessResult>
  
  // Process information
  getProcess(pid: ProcessId): ProcessInfo | null
  listProcesses(): ProcessInfo[]
  getRunningProcesses(): ProcessInfo[]
  
  // Process communication
  sendMessage(message: ProcessMessage): Promise<void>
  sendSignal(pid: ProcessId, signal: string): Promise<void>
  
  // Job control
  foreground(pid: ProcessId): Promise<void>
  background(pid: ProcessId): Promise<void>
  
  // Events
  on(event: string, callback: (event: ProcessEvent) => void): void
  off(event: string, callback: (event: ProcessEvent) => void): void
}