import { TerminalSession, type Terminal } from './terminal.js'

export class TerminalManager {
  private filesystem: any
  private runtimeManager: any
  private terminals = new Map<string, TerminalSession>()
  private nextId = 1

  constructor(filesystem: any, runtimeManager: any) {
    this.filesystem = filesystem
    this.runtimeManager = runtimeManager
  }

  create(initialCwd: string = '/'): Terminal {
    const id = `terminal_${this.nextId++}`
    const terminal = new TerminalSession(this.filesystem, this.runtimeManager, initialCwd)
    
    this.terminals.set(id, terminal)
    
    // Clean up when terminal is destroyed
    const originalDestroy = terminal.destroy.bind(terminal)
    terminal.destroy = () => {
      this.terminals.delete(id)
      originalDestroy()
    }
    
    return terminal
  }

  getActiveTerminals(): Terminal[] {
    return Array.from(this.terminals.values())
  }

  destroyAll(): void {
    for (const terminal of this.terminals.values()) {
      terminal.destroy()
    }
    this.terminals.clear()
  }
}