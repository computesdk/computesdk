import { Sandbox as E2BSandbox } from '@e2b/code-interpreter';
import type {
  ExecutionResult,
  Runtime,
  SandboxInfo,
  FileEntry,
  TerminalSession,
  TerminalCreateOptions,
  SandboxFileSystem,
  SandboxTerminal,
  Provider,
  ProviderSandboxManager,
  Sandbox,
  CreateSandboxOptions,
} from 'computesdk';

/**
 * E2B-specific configuration options
 */
export interface E2BConfig {
  /** E2B API key - if not provided, will fallback to E2B_API_KEY environment variable */
  apiKey?: string;
  /** Default runtime environment */
  runtime?: Runtime;
  /** Execution timeout in milliseconds */
  timeout?: number;
}

/**
 * E2B Sandbox implementation
 */
class E2BSandboxImpl implements Sandbox {
  readonly sandboxId: string;
  readonly provider = 'e2b';
  readonly filesystem: SandboxFileSystem;
  readonly terminal: SandboxTerminal;

  private session: E2BSandbox;
  private readonly runtime: Runtime;

  constructor(session: E2BSandbox, runtime: Runtime = 'python') {
    this.session = session;
    this.sandboxId = session.sandboxId || 'e2b-unknown';
    this.runtime = runtime;
    
    // Initialize filesystem and terminal
    this.filesystem = new E2BFileSystem(this.session);
    this.terminal = new E2BTerminal(this.session);
  }

  async runCode(code: string, runtime?: Runtime): Promise<ExecutionResult> {
    const startTime = Date.now();

    try {
      // Execute code using E2B's runCode API
      const execution = await this.session.runCode(code);

      return {
        stdout: execution.logs.stdout.join('\n'),
        stderr: execution.logs.stderr.join('\n'),
        exitCode: execution.error ? 1 : 0,
        executionTime: Date.now() - startTime,
        sandboxId: this.sandboxId,
        provider: this.provider
      };
    } catch (error) {
      throw new Error(
        `E2B execution failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  async runCommand(command: string, args: string[] = []): Promise<ExecutionResult> {
    const startTime = Date.now();

    try {
      // Construct full command with arguments
      const fullCommand = args.length > 0 ? `${command} ${args.join(' ')}` : command;

      // Execute command using E2B's bash execution via Python subprocess
      const execution = await this.session.runCode(`
import subprocess
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
      throw new Error(
        `E2B command execution failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  async getInfo(): Promise<SandboxInfo> {
    return {
      id: this.sandboxId,
      provider: this.provider,
      runtime: this.runtime,
      status: 'running', // E2B sandboxes are running when accessible
      createdAt: new Date(),
      timeout: 300000, // Default E2B timeout
      metadata: {
        e2bSessionId: this.sandboxId
      }
    };
  }

  async kill(): Promise<void> {
    try {
      await this.session.kill();
    } catch (error) {
      throw new Error(
        `Failed to kill E2B session: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
}

/**
 * E2B FileSystem implementation
 */
class E2BFileSystem implements SandboxFileSystem {
  constructor(private session: E2BSandbox) {}

  async readFile(path: string): Promise<string> {
    return await this.session.files.read(path, { format: 'text' });
  }

  async writeFile(path: string, content: string): Promise<void> {
    await this.session.files.write(path, content);
  }

  async mkdir(path: string): Promise<void> {
    await this.session.files.makeDir(path);
  }

  async readdir(path: string): Promise<FileEntry[]> {
    const entries = await this.session.files.list(path);

    return entries.map((entry: any) => ({
      name: entry.name,
      path: entry.path,
      isDirectory: Boolean(entry.isDir || entry.isDirectory),
      size: entry.size || 0,
      lastModified: new Date(entry.lastModified || Date.now())
    }));
  }

  async exists(path: string): Promise<boolean> {
    return await this.session.files.exists(path);
  }

  async remove(path: string): Promise<void> {
    await this.session.files.remove(path);
  }
}

/**
 * E2B Terminal implementation with PTY support
 */
class E2BTerminal implements SandboxTerminal {
  private activePtys: Map<number, { command: string; cols: number; rows: number }> = new Map();

  constructor(private session: E2BSandbox) {}

  async create(options: TerminalCreateOptions = {}): Promise<TerminalSession> {
    const command = options.command || 'bash';
    const cols = options.cols || 80;
    const rows = options.rows || 24;

    // Create PTY session using E2B's pty.create
    const ptyHandle = await this.session.pty.create({ 
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
    const terminalSession: TerminalSession = {
      pid: ptyHandle.pid,
      command,
      status: 'running',
      cols,
      rows,
      write: async (data: Uint8Array | string) => {
        const inputData = typeof data === 'string' ? new TextEncoder().encode(data) : data;
        await this.session.pty.sendInput(ptyHandle.pid, inputData);
      },
      resize: async (newCols: number, newRows: number) => {
        await this.session.pty.resize(ptyHandle.pid, { cols: newCols, rows: newRows });
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
        await this.session.pty.kill(ptyHandle.pid);
        this.activePtys.delete(ptyHandle.pid);
        terminalSession.status = 'exited';
      }
    };

    return terminalSession;
  }

  async list(): Promise<TerminalSession[]> {
    const terminals: TerminalSession[] = [];

    for (const [pid, info] of this.activePtys) {
      terminals.push({
        pid,
        command: info.command,
        status: 'running',
        cols: info.cols,
        rows: info.rows,
        write: async (data: Uint8Array | string) => {
          const inputData = typeof data === 'string' ? new TextEncoder().encode(data) : data;
          await this.session.pty.sendInput(pid, inputData);
        },
        resize: async (newCols: number, newRows: number) => {
          await this.session.pty.resize(pid, { cols: newCols, rows: newRows });
          // Update stored dimensions
          const ptyInfo = this.activePtys.get(pid);
          if (ptyInfo) {
            ptyInfo.cols = newCols;
            ptyInfo.rows = newRows;
          }
        },
        kill: async () => {
          await this.session.pty.kill(pid);
          this.activePtys.delete(pid);
        }
      });
    }

    return terminals;
  }
}

/**
 * E2B Sandbox Manager - implements ProviderSandboxManager
 */
class E2BSandboxManager implements ProviderSandboxManager {
  private activeSandboxes: Map<string, E2BSandboxImpl> = new Map();

  constructor(private config: E2BConfig) {
    // Validate API key
    const apiKey = config.apiKey || (typeof process !== 'undefined' && process.env?.E2B_API_KEY) || '';
    
    if (!apiKey) {
      throw new Error(
        `Missing E2B API key. Provide 'apiKey' in config or set E2B_API_KEY environment variable. Get your API key from https://e2b.dev/`
      );
    }

    // Validate API key format
    if (!apiKey.startsWith('e2b_')) {
      throw new Error(
        `Invalid E2B API key format. E2B API keys should start with 'e2b_'. Check your E2B_API_KEY environment variable.`
      );
    }
  }

  async create(options?: CreateSandboxOptions): Promise<Sandbox> {
    const apiKey = this.config.apiKey || process.env.E2B_API_KEY!;
    const runtime = options?.runtime || this.config.runtime || 'python';
    const timeout = this.config.timeout || 300000;

    try {
      let session: E2BSandbox;
      let sandboxId: string;

      if (options?.sandboxId) {
        // Reconnect to existing E2B session
        session = await E2BSandbox.connect(options.sandboxId, {
          apiKey: apiKey,
        });
        sandboxId = options.sandboxId;
      } else {
        // Create new E2B session
        session = await E2BSandbox.create({
          apiKey: apiKey,
          timeoutMs: timeout,
        });
        sandboxId = session.sandboxId || `e2b-${Date.now()}`;
      }

      const sandbox = new E2BSandboxImpl(session, runtime);
      this.activeSandboxes.set(sandbox.sandboxId, sandbox);
      
      return sandbox;
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
        `Failed to create E2B sandbox: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  async getById(sandboxId: string): Promise<Sandbox | null> {
    // Check if we have it in our active sandboxes
    const existing = this.activeSandboxes.get(sandboxId);
    if (existing) {
      return existing;
    }

    // Try to reconnect to existing E2B session
    try {
      const apiKey = this.config.apiKey || process.env.E2B_API_KEY!;
      const session = await E2BSandbox.connect(sandboxId, {
        apiKey: apiKey,
      });
      
      const sandbox = new E2BSandboxImpl(session, this.config.runtime || 'python');
      this.activeSandboxes.set(sandboxId, sandbox);
      
      return sandbox;
    } catch (error) {
      // Sandbox doesn't exist or can't be accessed
      return null;
    }
  }

  async list(): Promise<Sandbox[]> {
    // E2B doesn't have a native list API, so we return our active sandboxes
    // In a real implementation, you might want to store sandbox IDs in a database
    return Array.from(this.activeSandboxes.values());
  }

  async destroy(sandboxId: string): Promise<void> {
    const sandbox = this.activeSandboxes.get(sandboxId);
    if (sandbox) {
      await sandbox.kill();
      this.activeSandboxes.delete(sandboxId);
    }
    
    // If not in our active list, try to connect and kill
    try {
      const apiKey = this.config.apiKey || process.env.E2B_API_KEY!;
      const session = await E2BSandbox.connect(sandboxId, {
        apiKey: apiKey,
      });
      await session.kill();
    } catch (error) {
      // Sandbox might already be destroyed or doesn't exist
      // This is acceptable for destroy operations
    }
  }
}

/**
 * E2B Provider implementation
 */
export class E2BProvider implements Provider {
  readonly name = 'e2b';
  readonly sandbox: ProviderSandboxManager;

  constructor(config: E2BConfig = {}) {
    this.sandbox = new E2BSandboxManager(config);
  }
}

/**
 * Create an E2B provider instance
 */
export function e2b(config: E2BConfig = {}): E2BProvider {
  return new E2BProvider(config);
}