import { EventEmitter } from '../utils/events.js'
import type { ShellProcess, ShellStream } from './types.js'
import { ShellStreamImpl } from './stream.js'

export class ShellProcessImpl extends EventEmitter implements ShellProcess {
  public readonly pid: string
  public readonly command: string
  public readonly args: string[]
  
  public readonly stdin: ShellStream
  public readonly stdout: ShellStream
  public readonly stderr: ShellStream
  
  public exitCode: number | null = null
  public killed: boolean = false
  
  private startTime: number
  private endTime?: number

  constructor(command: string, args: string[] = []) {
    super()
    
    this.pid = `shell_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`
    this.command = command
    this.args = args
    this.startTime = Date.now()
    
    // Create streams
    this.stdin = new ShellStreamImpl()
    this.stdout = new ShellStreamImpl()
    this.stderr = new ShellStreamImpl()
    
    // Forward stream events
    this.stdout.on('data', (chunk) => this.emit('stdout', chunk))
    this.stderr.on('data', (chunk) => this.emit('stderr', chunk))
    
    // Handle stream end
    this.stdout.on('end', () => this.checkForCompletion())
    this.stderr.on('end', () => this.checkForCompletion())
  }

  kill(signal: string = 'SIGTERM'): void {
    if (this.killed || this.exitCode !== null) {
      return
    }
    
    this.killed = true
    this.exitCode = signal === 'SIGKILL' ? 137 : 143
    this.endTime = Date.now()
    
    // End all streams
    this.stdin.end()
    this.stdout.end()
    this.stderr.end()
    
    this.emit('close', this.exitCode, signal)
    this.emit('exit', this.exitCode, signal)
  }

  complete(exitCode: number = 0): void {
    if (this.killed || this.exitCode !== null) {
      return
    }
    
    this.exitCode = exitCode
    this.endTime = Date.now()
    
    // End output streams
    this.stdout.end()
    this.stderr.end()
    
    this.emit('close', exitCode)
    this.emit('exit', exitCode)
  }

  private checkForCompletion(): void {
    // If both stdout and stderr have ended and we haven't been killed
    if (!this.stdout.writable && !this.stderr.writable && !this.killed && this.exitCode === null) {
      this.complete(0)
    }
  }

  getExecutionTime(): number {
    const end = this.endTime || Date.now()
    return end - this.startTime
  }
}