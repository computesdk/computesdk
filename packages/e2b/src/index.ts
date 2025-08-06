import { Sandbox as E2BSandbox } from '@e2b/code-interpreter';
import type {
  ExecutionResult,
  Runtime,
  SandboxInfo,
  SandboxConfig,
  FileEntry,
  TerminalSession,
  InteractiveTerminalSession,
  TerminalCreateOptions,
  SandboxFileSystem,
  SandboxTerminal,
  FullComputeSpecification,
  FullComputeSandbox,
} from 'computesdk';
import { BaseProvider, BaseFileSystem, BaseTerminal } from 'computesdk';

/**
 * E2B-specific configuration options
 */
export interface E2BConfig extends SandboxConfig {
  /** E2B API key - if not provided, will fallback to E2B_API_KEY environment variable */
  apiKey?: string;
}

/**
 * E2B FileSystem implementation
 */
class E2BFileSystem extends BaseFileSystem {
  constructor(
    provider: string,
    sandboxId: string,
    private getSession: () => Promise<E2BSandbox>
  ) {
    super(provider, sandboxId);
  }

  protected async doReadFile(path: string): Promise<string> {
    const session = await this.getSession();
    return await session.files.read(path, { format: 'text' });
  }

  protected async doWriteFile(path: string, content: string): Promise<void> {
    const session = await this.getSession();
    await session.files.write(path, content);
  }

  protected async doMkdir(path: string): Promise<void> {
    const session = await this.getSession();
    await session.files.makeDir(path);
  }

  protected async doReaddir(path: string): Promise<FileEntry[]> {
    const session = await this.getSession();
    const entries = await session.files.list(path);

    return entries.map((entry: any) => ({
      name: entry.name,
      path: entry.path,
      isDirectory: Boolean(entry.isDir || entry.isDirectory),
      size: entry.size || 0,
      lastModified: new Date(entry.lastModified || Date.now())
    }));
  }

  protected async doExists(path: string): Promise<boolean> {
    const session = await this.getSession();
    return await session.files.exists(path);
  }

  protected async doRemove(path: string): Promise<void> {
    const session = await this.getSession();
    await session.files.remove(path);
  }
}

/**
 * E2B Terminal implementation with PTY support
 */
class E2BTerminal extends BaseTerminal {
  private activePtys: Map<number, { command: string; cols: number; rows: number }> = new Map();

  constructor(
    provider: string,
    sandboxId: string,
    private getSession: () => Promise<E2BSandbox>
  ) {
    super(provider, sandboxId);
  }

  async create(options: TerminalCreateOptions = {}): Promise<InteractiveTerminalSession> {
    const session = await this.getSession();
    const command = options.command || 'bash';
    const cols = options.cols || 80;
    const rows = options.rows || 24;

    // Create PTY session using E2B's pty.create
    const ptyHandle = await session.pty.create({ 
      cols: cols, 
      rows: rows,
      onData: (data: Uint8Array) => {
        // PTY output handler - applications can subscribe to this
        if (terminalSession.onData) {
          terminalSession.onData(data);
        }
      }
    });

    // Store PTY info for management
    this.activePtys.set(ptyHandle.pid, { command, cols, rows });

    // Create terminal session with methods
    const terminalSession: InteractiveTerminalSession = {
      pid: ptyHandle.pid,
      command,
      status: 'running',
      cols,
      rows,
      write: async (data: Uint8Array | string) => {
        const inputData = typeof data === 'string' ? new TextEncoder().encode(data) : data;
        await session.pty.sendInput(ptyHandle.pid, inputData);
      },
      resize: async (newCols: number, newRows: number) => {
        await session.pty.resize(ptyHandle.pid, { cols: newCols, rows: newRows });
        terminalSession.cols = newCols;
        terminalSession.rows = newRows;
        // Update stored dimensions
        const ptyInfo = this.activePtys.get(ptyHandle.pid);
        if (ptyInfo) {
          ptyInfo.cols = newCols;
          ptyInfo.rows = newRows;
        }
      },
      kill: async () => {
        await session.pty.kill(ptyHandle.pid);
        this.activePtys.delete(ptyHandle.pid);
        terminalSession.status = 'exited';
      }
    };

    return terminalSession;
  }


  async list(): Promise<InteractiveTerminalSession[]> {
    const session = await this.getSession();
    const terminals: InteractiveTerminalSession[] = [];

    for (const [pid, info] of this.activePtys) {
      terminals.push({
        pid,
        command: info.command,
        status: 'running',
        cols: info.cols,
        rows: info.rows,
        write: async (data: Uint8Array | string) => {
          const inputData = typeof data === 'string' ? new TextEncoder().encode(data) : data;
          await session.pty.sendInput(pid, inputData);
        },
        resize: async (newCols: number, newRows: number) => {
          await session.pty.resize(pid, { cols: newCols, rows: newRows });
          // Update stored dimensions
          const ptyInfo = this.activePtys.get(pid);
          if (ptyInfo) {
            ptyInfo.cols = newCols;
            ptyInfo.rows = newRows;
          }
        },
        kill: async () => {
          await session.pty.kill(pid);
          this.activePtys.delete(pid);
        }
      });
    }

    return terminals;
  }

  // Protected methods for BaseTerminal compatibility
  protected async doCreate(options?: TerminalCreateOptions): Promise<InteractiveTerminalSession> {
    return await this.create(options);
  }

  protected async doList(): Promise<InteractiveTerminalSession[]> {
    return await this.list();
  }
}

export class E2BProvider extends BaseProvider implements FullComputeSandbox, FullComputeSpecification {
  private session: E2BSandbox | null = null;
  private readonly apiKey: string;
  private readonly runtime: Runtime;
  public readonly filesystem: SandboxFileSystem;
  public readonly terminal: SandboxTerminal;

  constructor(config: E2BConfig) {
    super('e2b', config.timeout || 300000);

    // Get API key from config or environment
    this.apiKey = config.apiKey || (typeof process !== 'undefined' && process.env?.E2B_API_KEY) || '';

    if (!this.apiKey) {
      throw new Error(
        `Missing E2B API key. Provide 'apiKey' in config or set E2B_API_KEY environment variable. Get your API key from https://e2b.dev/`
      );
    }

    // Validate API key format
    if (!this.apiKey.startsWith('e2b_')) {
      throw new Error(
        `Invalid E2B API key format. E2B API keys should start with 'e2b_'. Check your E2B_API_KEY environment variable.`
      );
    }

    this.runtime = config.runtime || 'python';

    // Initialize filesystem and terminal
    this.filesystem = new E2BFileSystem(this.provider, this.sandboxId, () => this.ensureSession());
    this.terminal = new E2BTerminal(this.provider, this.sandboxId, () => this.ensureSession());
  }

  private async ensureSession(): Promise<E2BSandbox> {
    if (this.session) {
      return this.session;
    }

    try {
      // Create new E2B session with configuration
      this.session = await E2BSandbox.create({
        apiKey: this.apiKey,
        timeoutMs: this.timeout,
      });

      return this.session;
    } catch (error) {
      if (error instanceof Error) {
        if (error.message.includes('unauthorized') || error.message.includes('API key')) {
          throw new Error(
            `E2B authentication failed. Please check your E2B_API_KEY environment variable. Get your API key from https://e2b.dev/`
          );
        }
        if (error.message.includes('quota') || error.message.includes('limit')) {
          throw new Error(
            `E2B quota exceeded. Please check your usage at https://e2b.dev/`
          );
        }
      }
      throw new Error(
        `Failed to initialize E2B session: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  async doExecute(code: string, runtime?: Runtime): Promise<ExecutionResult> {
    const startTime = Date.now();

    try {
      const session = await this.ensureSession();

      // Execute code using E2B's runCode API
      const execution = await session.runCode(code);

      return {
        stdout: execution.logs.stdout.join('\n'),
        stderr: execution.logs.stderr.join('\n'),
        exitCode: execution.error ? 1 : 0,
        executionTime: Date.now() - startTime,
        sandboxId: this.sandboxId,
        provider: this.provider
      };
    } catch (error) {
      if (error instanceof Error) {
        if (error.message.includes('timeout')) {
          throw new Error(
            `E2B execution timeout (${this.timeout}ms). Consider increasing the timeout or optimizing your code.`
          );
        }
        if (error.message.includes('memory') || error.message.includes('Memory')) {
          throw new Error(
            `E2B execution failed due to memory limits. Consider optimizing your code or using smaller data sets.`
          );
        }
      }
      throw new Error(
        `E2B execution failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  async runCode(code: string, runtime?: Runtime): Promise<ExecutionResult> {
    return this.doExecute(code, runtime);
  }

  async runCommand(command: string, args: string[] = []): Promise<ExecutionResult> {
    const startTime = Date.now();

    try {
      const session = await this.ensureSession();

      // Construct full command with arguments
      const fullCommand = args.length > 0 ? `${command} ${args.join(' ')}` : command;

      // Execute command using E2B's bash execution
      const execution = await session.runCode(`import subprocess
import sys

result = subprocess.run(${JSON.stringify(fullCommand)}, shell=True, capture_output=True, text=True)
print(result.stdout, end='')
if result.stderr:
    print(result.stderr, end='', file=sys.stderr)
sys.exit(result.returncode)
`);

      return {
        stdout: execution.logs.stdout.join('\n'),
        stderr: execution.logs.stderr.join('\n'),
        exitCode: execution.error ? 1 : 0,
        executionTime: Date.now() - startTime,
        sandboxId: this.sandboxId,
        provider: this.provider
      };
    } catch (error) {
      if (error instanceof Error) {
        if (error.message.includes('timeout')) {
          throw new Error(
            `E2B command timeout (${this.timeout}ms). Consider increasing the timeout or optimizing your command.`
          );
        }
        if (error.message.includes('memory') || error.message.includes('Memory')) {
          throw new Error(
            `E2B command failed due to memory limits. Consider optimizing your command.`
          );
        }
      }
      throw new Error(
        `E2B command execution failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  async doKill(): Promise<void> {
    if (!this.session) {
      return;
    }

    try {
      await this.session.kill();
      this.session = null;
    } catch (error) {
      throw new Error(
        `Failed to kill E2B session: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  async doGetInfo(): Promise<SandboxInfo> {
    await this.ensureSession();

    return {
      id: this.sandboxId,
      provider: this.provider,
      runtime: this.runtime,
      status: this.session ? 'running' : 'stopped',
      createdAt: new Date(),
      timeout: this.timeout,
      metadata: {
        e2bSessionId: this.sandboxId
      }
    };
  }

}

export function e2b(config?: Partial<E2BConfig>): E2BProvider {
  const fullConfig: E2BConfig = {
    provider: 'e2b',
    runtime: 'python',
    timeout: 300000,
    ...config
  };

  return new E2BProvider(fullConfig);
}
