import { EventEmitter } from '../utils/events.js'
import type { ShellStream } from './types.js'

export class ShellStreamImpl extends EventEmitter implements ShellStream {
  private _readable: boolean = true
  private _writable: boolean = true
  private buffer: string = ''
  private ended: boolean = false

  get readable(): boolean {
    return this._readable && !this.ended
  }

  get writable(): boolean {
    return this._writable && !this.ended
  }

  write(chunk: string): boolean {
    if (!this.writable) {
      return false
    }

    this.buffer += chunk
    this.emit('data', chunk)
    return true
  }

  end(): void {
    if (this.ended) return
    
    this.ended = true
    this._writable = false
    this.emit('end')
  }

  getBuffer(): string {
    return this.buffer
  }

  clearBuffer(): void {
    this.buffer = ''
  }
}