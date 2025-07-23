import type { ShellProcess, ShellEnvironment } from './types.js'
import { ShellProcessImpl } from './process.js'
import { getCommand } from './commands/index.js'

export class Shell {
  private environment: ShellEnvironment
  private filesystem: any
  private runtimeManager: any
  private processes = new Map<string, ShellProcess>()

  constructor(filesystem: any, runtimeManager: any, initialCwd: string = '/') {
    this.filesystem = filesystem
    this.runtimeManager = runtimeManager
    this.environment = {
      cwd: initialCwd,
      env: {
        PATH: '/usr/local/bin:/usr/bin:/bin',
        HOME: '/',
        USER: 'browser',
        PWD: initialCwd,
      },
      path: ['/usr/local/bin', '/usr/bin', '/bin']
    }
  }

  // Node.js-style spawn
  spawn(command: string, args: string[] = []): ShellProcess {
    const process = new ShellProcessImpl(command, args)
    this.processes.set(process.pid, process)

    // Execute the command asynchronously
    this.executeCommand(process, command, args)

    return process
  }

  private async executeCommand(process: ShellProcess, command: string, args: string[]): Promise<void> {
    try {
      const cmd = getCommand(command)
      
      if (!cmd) {
        process.stderr.write(`${command}: command not found\n`)
        ;(process as ShellProcessImpl).complete(127)
        return
      }

      const result = await cmd.execute(args, {
        cwd: this.environment.cwd,
        env: this.environment.env,
        filesystem: this.filesystem,
        runtimeManager: this.runtimeManager
      })

      // Write output to process streams
      if (result.stdout) {
        process.stdout.write(result.stdout)
      }
      if (result.stderr) {
        process.stderr.write(result.stderr)
      }

      ;(process as ShellProcessImpl).complete(result.exitCode)
    } catch (error) {
      process.stderr.write(`${command}: ${error instanceof Error ? error.message : String(error)}\n`)
      ;(process as ShellProcessImpl).complete(1)
    } finally {
      // Clean up completed process after a delay
      setTimeout(() => {
        this.processes.delete(process.pid)
      }, 5000)
    }
  }

  // Environment management
  getCwd(): string {
    return this.environment.cwd
  }

  setCwd(path: string): void {
    this.environment.cwd = path
    this.environment.env.PWD = path
  }

  getEnv(key: string): string | undefined {
    return this.environment.env[key]
  }

  setEnv(key: string, value: string): void {
    this.environment.env[key] = value
  }

  // Process management
  getProcess(pid: string): ShellProcess | undefined {
    return this.processes.get(pid)
  }

  getAllProcesses(): ShellProcess[] {
    return Array.from(this.processes.values())
  }

  killAll(): void {
    for (const process of this.processes.values()) {
      process.kill('SIGTERM')
    }
  }
}