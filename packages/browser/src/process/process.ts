import type { RuntimeManager } from '../runtime/manager.js'
import type { 
  ProcessId, 
  ProcessStatus, 
  ProcessOptions, 
  ProcessInfo, 
  ProcessResult,
  ProcessEvent,
  ProcessMessage
} from './types.js'

export class Process {
  public readonly pid: ProcessId
  public readonly name: string
  private status: ProcessStatus = 'created'
  private code: string
  private options: Required<ProcessOptions>
  private runtimeManager: RuntimeManager
  
  // Timing
  private createdAt: Date = new Date()
  private startedAt?: Date
  private completedAt?: Date
  private executionTime: number = 0
  
  // I/O
  private stdin: string = ''
  private stdout: string = ''
  private stderr: string = ''
  private exitCode?: number
  
  // Process relationships
  private parentPid?: ProcessId
  private childPids: ProcessId[] = []
  
  // Execution control
  private abortController?: AbortController
  private executionPromise?: Promise<ProcessResult>
  private eventListeners: Map<string, ((event: ProcessEvent) => void)[]> = new Map()
  private messageQueue: ProcessMessage[] = []

  constructor(
    code: string, 
    options: ProcessOptions, 
    runtimeManager: RuntimeManager,
    parentPid?: ProcessId
  ) {
    this.pid = this.generatePid()
    this.name = this.extractProcessName(code)
    this.code = code
    this.runtimeManager = runtimeManager
    this.parentPid = parentPid
    
    // Set defaults for options
    this.options = {
      runtime: options.runtime,
      cwd: options.cwd || '/',
      env: options.env || {},
      priority: options.priority || 'normal',
      background: options.background || false,
      timeout: options.timeout || 30000, // 30 seconds default
      stdin: options.stdin || '',
      args: options.args || []
    }
    
    this.stdin = this.options.stdin
    this.emitEvent('created')
  }

  async start(): Promise<void> {
    if (this.status !== 'created') {
      throw new Error(`Process ${this.pid} cannot be started from status ${this.status}`)
    }

    this.status = 'running'
    this.startedAt = new Date()
    this.abortController = new AbortController()
    this.emitEvent('started')

    // Start execution in background
    this.executionPromise = this.executeCode()
    
    // If not background process, wait for completion
    if (!this.options.background) {
      await this.executionPromise
    }
  }

  async kill(signal: string = 'SIGTERM'): Promise<void> {
    if (this.status === 'completed' || this.status === 'failed' || this.status === 'killed') {
      return // Already terminated
    }

    this.status = 'killed'
    this.completedAt = new Date()
    this.exitCode = signal === 'SIGKILL' ? 137 : 143 // Standard exit codes
    
    // Abort execution if running
    if (this.abortController) {
      this.abortController.abort()
    }
    
    // Kill child processes
    for (const childPid of this.childPids) {
      this.emitEvent('output', { message: `Killing child process ${childPid}` })
    }
    
    this.emitEvent('killed', { signal })
  }

  async suspend(): Promise<void> {
    if (this.status !== 'running') {
      throw new Error(`Process ${this.pid} cannot be suspended from status ${this.status}`)
    }
    
    this.status = 'suspended'
    // Note: Actual suspension of JavaScript/Python execution is complex
    // For now, we'll just mark it as suspended
    this.emitEvent('output', { message: 'Process suspended (pause not fully implemented)' })
  }

  async resume(): Promise<void> {
    if (this.status !== 'suspended') {
      throw new Error(`Process ${this.pid} cannot be resumed from status ${this.status}`)
    }
    
    this.status = 'running'
    this.emitEvent('output', { message: 'Process resumed' })
  }

  async wait(): Promise<ProcessResult> {
    if (!this.executionPromise) {
      throw new Error(`Process ${this.pid} has not been started`)
    }
    
    return await this.executionPromise
  }

  sendMessage(message: ProcessMessage): void {
    this.messageQueue.push(message)
    this.emitEvent('output', { message: `Received message from ${message.from}` })
  }

  getInfo(): ProcessInfo {
    return {
      pid: this.pid,
      name: this.name,
      status: this.status,
      runtime: this.options.runtime,
      cwd: this.options.cwd,
      env: this.options.env,
      priority: this.options.priority,
      background: this.options.background,
      
      createdAt: this.createdAt,
      startedAt: this.startedAt,
      completedAt: this.completedAt,
      
      executionTime: this.executionTime,
      
      stdin: this.stdin,
      stdout: this.stdout,
      stderr: this.stderr,
      exitCode: this.exitCode,
      
      parentPid: this.parentPid,
      childPids: [...this.childPids]
    }
  }

  addChild(childPid: ProcessId): void {
    this.childPids.push(childPid)
  }

  removeChild(childPid: ProcessId): void {
    const index = this.childPids.indexOf(childPid)
    if (index > -1) {
      this.childPids.splice(index, 1)
    }
  }

  on(event: string, callback: (event: ProcessEvent) => void): void {
    if (!this.eventListeners.has(event)) {
      this.eventListeners.set(event, [])
    }
    this.eventListeners.get(event)!.push(callback)
  }

  off(event: string, callback: (event: ProcessEvent) => void): void {
    const listeners = this.eventListeners.get(event)
    if (listeners) {
      const index = listeners.indexOf(callback)
      if (index > -1) {
        listeners.splice(index, 1)
      }
    }
  }

  private async executeCode(): Promise<ProcessResult> {
    const startTime = Date.now()
    
    try {
      // Set up timeout
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('Process timeout')), this.options.timeout)
      })
      
      // Execute code with timeout
      const result = await Promise.race([
        this.runtimeManager.execute(this.code, this.options.runtime),
        timeoutPromise
      ])
      
      // Update process state
      this.stdout += result.stdout
      this.stderr += result.stderr
      this.exitCode = result.exitCode
      this.executionTime = Date.now() - startTime
      this.completedAt = new Date()
      
      if (result.exitCode === 0) {
        this.status = 'completed'
        this.emitEvent('completed')
      } else {
        this.status = 'failed'
        this.emitEvent('error', { exitCode: result.exitCode })
      }
      
      return {
        pid: this.pid,
        exitCode: result.exitCode,
        stdout: result.stdout,
        stderr: result.stderr,
        executionTime: this.executionTime,
        status: this.status
      }
      
    } catch (error) {
      this.status = 'failed'
      this.exitCode = 1
      this.stderr += error instanceof Error ? error.message : String(error)
      this.executionTime = Date.now() - startTime
      this.completedAt = new Date()
      
      this.emitEvent('error', { error: error instanceof Error ? error.message : String(error) })
      
      return {
        pid: this.pid,
        exitCode: 1,
        stdout: this.stdout,
        stderr: this.stderr,
        executionTime: this.executionTime,
        status: this.status
      }
    }
  }

  private emitEvent(type: ProcessEvent['type'], data?: any): void {
    const event: ProcessEvent = {
      type,
      pid: this.pid,
      timestamp: new Date(),
      data
    }
    
    const listeners = this.eventListeners.get(type) || []
    const allListeners = this.eventListeners.get('*') || []
    const allCallbacks = [...listeners, ...allListeners]
    
    allCallbacks.forEach(callback => {
      try {
        callback(event)
      } catch (error) {
        console.error('Error in process event listener:', error)
      }
    })
  }

  private generatePid(): ProcessId {
    return `proc_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`
  }

  private extractProcessName(code: string): string {
    // Try to extract a meaningful name from the code
    const lines = code.trim().split('\n')
    const firstLine = lines[0]?.trim() || ''
    
    // Look for comments that might indicate the process name
    if (firstLine.startsWith('//') || firstLine.startsWith('#')) {
      const comment = firstLine.replace(/^[\/\#]+\s*/, '').trim()
      if (comment.length > 0 && comment.length < 50) {
        return comment
      }
    }
    
    // Look for function definitions
    const funcMatch = code.match(/(?:function|def)\s+(\w+)/)
    if (funcMatch) {
      return funcMatch[1]
    }
    
    // Default to a truncated version of the code
    const truncated = code.replace(/\s+/g, ' ').substring(0, 30)
    return truncated.length < code.length ? truncated + '...' : truncated
  }
}