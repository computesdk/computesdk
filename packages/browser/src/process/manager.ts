import type { RuntimeManager } from '../runtime/manager.js'
import { Process } from './process.js'
import type { 
  ProcessId, 
  ProcessOptions, 
  ProcessInfo, 
  ProcessResult,
  ProcessEvent,
  ProcessMessage,
  IProcessManager
} from './types.js'

export class ProcessManager implements IProcessManager {
  private processes = new Map<ProcessId, Process>()
  private runtimeManager: RuntimeManager
  private eventListeners = new Map<string, ((event: ProcessEvent) => void)[]>()
  private messageQueue: ProcessMessage[] = []
  private currentForegroundPid?: ProcessId
  
  // Process limits and resource management
  private maxProcesses: number = 50
  private processCounter: number = 0

  constructor(runtimeManager: RuntimeManager) {
    this.runtimeManager = runtimeManager
  }

  async spawn(code: string, options: ProcessOptions): Promise<ProcessId> {
    // Check process limits
    if (this.processes.size >= this.maxProcesses) {
      throw new Error(`Maximum number of processes (${this.maxProcesses}) reached`)
    }

    // Create new process
    const process = new Process(code, options, this.runtimeManager)
    const pid = process.pid
    
    // Register process
    this.processes.set(pid, process)
    this.processCounter++
    
    // Set up event forwarding
    process.on('*', (event) => this.forwardEvent(event))
    
    // Start the process
    try {
      await process.start()
      
      // If foreground process, set as current
      if (!options.background) {
        this.currentForegroundPid = pid
      }
      
      return pid
    } catch (error) {
      // Clean up on failure
      this.processes.delete(pid)
      throw error
    }
  }

  async kill(pid: ProcessId, signal: string = 'SIGTERM'): Promise<void> {
    const process = this.processes.get(pid)
    if (!process) {
      throw new Error(`Process ${pid} not found`)
    }

    await process.kill(signal)
    
    // Clean up completed process after a delay
    setTimeout(() => {
      if (process.getInfo().status === 'killed') {
        this.processes.delete(pid)
      }
    }, 1000)
    
    // Update foreground process
    if (this.currentForegroundPid === pid) {
      this.currentForegroundPid = undefined
    }
  }

  async suspend(pid: ProcessId): Promise<void> {
    const process = this.processes.get(pid)
    if (!process) {
      throw new Error(`Process ${pid} not found`)
    }

    await process.suspend()
  }

  async resume(pid: ProcessId): Promise<void> {
    const process = this.processes.get(pid)
    if (!process) {
      throw new Error(`Process ${pid} not found`)
    }

    await process.resume()
  }

  async wait(pid: ProcessId): Promise<ProcessResult> {
    const process = this.processes.get(pid)
    if (!process) {
      throw new Error(`Process ${pid} not found`)
    }

    const result = await process.wait()
    
    // Clean up completed process
    if (result.status === 'completed' || result.status === 'failed') {
      setTimeout(() => this.processes.delete(pid), 1000)
    }
    
    return result
  }

  getProcess(pid: ProcessId): ProcessInfo | null {
    const process = this.processes.get(pid)
    return process ? process.getInfo() : null
  }

  listProcesses(): ProcessInfo[] {
    return Array.from(this.processes.values()).map(p => p.getInfo())
  }

  getRunningProcesses(): ProcessInfo[] {
    return this.listProcesses().filter(p => p.status === 'running')
  }

  async sendMessage(message: ProcessMessage): Promise<void> {
    const targetProcess = this.processes.get(message.to)
    if (!targetProcess) {
      throw new Error(`Target process ${message.to} not found`)
    }

    targetProcess.sendMessage(message)
    this.messageQueue.push(message)
  }

  async sendSignal(pid: ProcessId, signal: string): Promise<void> {
    const process = this.processes.get(pid)
    if (!process) {
      throw new Error(`Process ${pid} not found`)
    }

    // Handle different signals
    switch (signal) {
      case 'SIGTERM':
      case 'SIGKILL':
        await this.kill(pid, signal)
        break
      case 'SIGSTOP':
        await this.suspend(pid)
        break
      case 'SIGCONT':
        await this.resume(pid)
        break
      default:
        // Custom signal - just send as message
        await this.sendMessage({
          from: 'system',
          to: pid,
          type: 'signal',
          payload: { signal },
          timestamp: new Date()
        })
    }
  }

  async foreground(pid: ProcessId): Promise<void> {
    const process = this.processes.get(pid)
    if (!process) {
      throw new Error(`Process ${pid} not found`)
    }

    const info = process.getInfo()
    if (info.status !== 'running' && info.status !== 'suspended') {
      throw new Error(`Process ${pid} is not running (status: ${info.status})`)
    }

    // Resume if suspended
    if (info.status === 'suspended') {
      await this.resume(pid)
    }

    this.currentForegroundPid = pid
    this.emitEvent('output', pid, { message: `Process ${pid} brought to foreground` })
  }

  async background(pid: ProcessId): Promise<void> {
    const process = this.processes.get(pid)
    if (!process) {
      throw new Error(`Process ${pid} not found`)
    }

    if (this.currentForegroundPid === pid) {
      this.currentForegroundPid = undefined
    }

    this.emitEvent('output', pid, { message: `Process ${pid} sent to background` })
  }

  // Job control methods
  getCurrentForegroundProcess(): ProcessInfo | null {
    return this.currentForegroundPid ? this.getProcess(this.currentForegroundPid) : null
  }

  getBackgroundProcesses(): ProcessInfo[] {
    return this.listProcesses().filter(p => 
      p.background || (p.status === 'running' && p.pid !== this.currentForegroundPid)
    )
  }

  // Process management utilities
  async killAll(signal: string = 'SIGTERM'): Promise<void> {
    const pids = Array.from(this.processes.keys())
    await Promise.all(pids.map(pid => this.kill(pid, signal)))
  }

  async waitForAll(): Promise<ProcessResult[]> {
    const processes = Array.from(this.processes.values())
    const runningProcesses = processes.filter(p => {
      const status = p.getInfo().status
      return status === 'running' || status === 'suspended'
    })
    
    return Promise.all(runningProcesses.map(p => p.wait()))
  }

  getProcessStats(): {
    total: number
    running: number
    completed: number
    failed: number
    suspended: number
  } {
    const processes = this.listProcesses()
    return {
      total: processes.length,
      running: processes.filter(p => p.status === 'running').length,
      completed: processes.filter(p => p.status === 'completed').length,
      failed: processes.filter(p => p.status === 'failed').length,
      suspended: processes.filter(p => p.status === 'suspended').length
    }
  }

  // Event system
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

  private forwardEvent(event: ProcessEvent): void {
    this.emitEvent(event.type, event.pid, event.data)
  }

  private emitEvent(type: ProcessEvent['type'], pid: ProcessId, data?: any): void {
    const event: ProcessEvent = {
      type,
      pid,
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
        console.error('Error in process manager event listener:', error)
      }
    })
  }

  // Cleanup
  async cleanup(): Promise<void> {
    await this.killAll('SIGKILL')
    this.processes.clear()
    this.eventListeners.clear()
    this.messageQueue = []
    this.currentForegroundPid = undefined
  }
}