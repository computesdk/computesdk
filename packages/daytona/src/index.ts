import { Daytona, Sandbox as DaytonaSandbox } from '@daytonaio/sdk';
import type {
  ExecutionResult,
  Runtime,
  SandboxInfo,
  FileEntry,
  SandboxFileSystem,
  SandboxTerminal,
  TerminalSession,
  TerminalCreateOptions,
  Provider,
  ProviderSandboxManager,
  Sandbox,
  CreateSandboxOptions,
} from 'computesdk';

/**
 * Daytona-specific configuration options
 */
export interface DaytonaConfig {
  /** Daytona API key - if not provided, will fallback to DAYTONA_API_KEY environment variable */
  apiKey?: string;
  /** Default runtime environment */
  runtime?: Runtime;
  /** Execution timeout in milliseconds */
  timeout?: number;
}

/**
 * Daytona Sandbox implementation
 */
class DaytonaSandboxImpl implements Sandbox {
  readonly sandboxId: string;
  readonly provider = 'daytona';
  readonly filesystem: SandboxFileSystem;
  readonly terminal: SandboxTerminal;

  private session: DaytonaSandbox;
  private readonly runtime: Runtime;

  constructor(session: DaytonaSandbox, runtime: Runtime = 'python') {
    this.session = session;
    this.sandboxId = session.id;
    this.runtime = runtime;
    
    // Initialize filesystem and terminal
    this.filesystem = new DaytonaFileSystem(this.session);
    this.terminal = new DaytonaTerminal(this.session);
  }

  async runCode(code: string, runtime?: Runtime): Promise<ExecutionResult> {
    const startTime = Date.now();

    try {
      // Execute code using Daytona's process.codeRun method
      const response = await this.session.process.codeRun(code);
      
      return {
        stdout: response.result || '',
        stderr: '', // Daytona doesn't separate stderr in the response
        exitCode: response.exitCode || 0,
        executionTime: Date.now() - startTime,
        sandboxId: this.sandboxId,
        provider: this.provider
      };
    } catch (error) {
      throw new Error(
        `Daytona execution failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  async runCommand(command: string, args: string[] = []): Promise<ExecutionResult> {
    const startTime = Date.now();

    try {
      // Construct full command with arguments
      const fullCommand = args.length > 0 ? `${command} ${args.join(' ')}` : command;

      // Execute command using Daytona's process.executeCommand method
      const response = await this.session.process.executeCommand(fullCommand);
      
      return {
        stdout: response.result || '',
        stderr: '', // Daytona doesn't separate stderr in the response
        exitCode: response.exitCode || 0,
        executionTime: Date.now() - startTime,
        sandboxId: this.sandboxId,
        provider: this.provider
      };
    } catch (error) {
      throw new Error(
        `Daytona command execution failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  async getInfo(): Promise<SandboxInfo> {
    return {
      id: this.sandboxId,
      provider: this.provider,
      runtime: this.runtime,
      status: this.session.state === 'started' ? 'running' : 'stopped',
      createdAt: this.session.createdAt ? new Date(this.session.createdAt) : new Date(),
      timeout: 300000, // Default Daytona timeout
      metadata: {
        daytonaSessionId: this.sandboxId,
        state: this.session.state,
        target: this.session.target,
        cpu: this.session.cpu,
        memory: this.session.memory,
        disk: this.session.disk
      }
    };
  }

  async kill(): Promise<void> {
    try {
      // Use the Daytona client to delete the sandbox
      // Note: We need access to the Daytona client instance for this
      // For now, we'll throw an error indicating this needs to be handled by the manager
      throw new Error('Sandbox deletion must be handled by the DaytonaSandboxManager');
    } catch (error) {
      throw new Error(
        `Failed to kill Daytona session: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
}

/**
 * Daytona FileSystem implementation
 */
class DaytonaFileSystem implements SandboxFileSystem {
  constructor(private session: DaytonaSandbox) {}

  async readFile(path: string): Promise<string> {
    try {
      // Use Daytona's file system API to download file as buffer, then convert to string
      const buffer = await this.session.fs.downloadFile(path);
      return buffer.toString('utf-8');
    } catch (error) {
      throw new Error(`Failed to read file ${path}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async writeFile(path: string, content: string): Promise<void> {
    try {
      // Use Daytona's file system API to upload file from buffer
      const buffer = Buffer.from(content, 'utf-8');
      await this.session.fs.uploadFile(buffer, path);
    } catch (error) {
      throw new Error(`Failed to write file ${path}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async mkdir(path: string): Promise<void> {
    try {
      // Use Daytona's file system API to create directory
      await this.session.fs.createFolder(path, '755');
    } catch (error) {
      throw new Error(`Failed to create directory ${path}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async readdir(path: string): Promise<FileEntry[]> {
    try {
      // Use Daytona's file system API to list directory
      const entries = await this.session.fs.listFiles(path);

      return entries.map((entry: any) => ({
        name: entry.name,
        path: entry.path || `${path}/${entry.name}`,
        isDirectory: Boolean(entry.isDir || entry.isDirectory || entry.type === 'directory'),
        size: entry.size || 0,
        lastModified: new Date(entry.modTime || entry.lastModified || Date.now())
      }));
    } catch (error) {
      throw new Error(`Failed to read directory ${path}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async exists(path: string): Promise<boolean> {
    try {
      // Use Daytona's file system API to get file details - if it succeeds, file exists
      await this.session.fs.getFileDetails(path);
      return true;
    } catch (error) {
      // If the API call fails, assume file doesn't exist
      return false;
    }
  }

  async remove(path: string): Promise<void> {
    try {
      // Use Daytona's file system API to delete file/directory
      await this.session.fs.deleteFile(path);
    } catch (error) {
      throw new Error(`Failed to remove ${path}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

/**
 * Daytona Terminal implementation (Note: Daytona doesn't support terminal operations by design)
 */
class DaytonaTerminal implements SandboxTerminal {
  constructor(private session: DaytonaSandbox) {}

  async create(options: TerminalCreateOptions = {}): Promise<TerminalSession> {
    // Daytona doesn't support terminal operations by design
    throw new Error('Terminal operations are not supported by Daytona provider. Use runCode() or runCommand() instead.');
  }

  async list(): Promise<TerminalSession[]> {
    // Daytona doesn't support terminal operations by design
    return [];
  }
}

/**
 * Daytona Sandbox Manager - implements ProviderSandboxManager
 */
class DaytonaSandboxManager implements ProviderSandboxManager {
  private activeSandboxes: Map<string, DaytonaSandboxImpl> = new Map();
  private daytona: Daytona;

  constructor(private config: DaytonaConfig) {
    // Validate API key
    const apiKey = config.apiKey || (typeof process !== 'undefined' && process.env?.DAYTONA_API_KEY) || '';
    
    if (!apiKey) {
      throw new Error(
        `Missing Daytona API key. Provide 'apiKey' in config or set DAYTONA_API_KEY environment variable. Get your API key from https://daytona.io/`
      );
    }

    // Initialize Daytona client
    this.daytona = new Daytona({ apiKey: apiKey });
  }

  async create(options?: CreateSandboxOptions): Promise<Sandbox> {
    const runtime = options?.runtime || this.config.runtime || 'python';

    try {
      let session: DaytonaSandbox;

      if (options?.sandboxId) {
        // Reconnect to existing Daytona session
        session = await this.daytona.get(options.sandboxId);
      } else {
        // Create new Daytona session
        session = await this.daytona.create({
          language: runtime === 'python' ? 'python' : 'typescript',
        });
      }

      const sandbox = new DaytonaSandboxImpl(session, runtime);
      this.activeSandboxes.set(sandbox.sandboxId, sandbox);
      
      return sandbox;
    } catch (error) {
      if (error instanceof Error) {
        if (error.message.includes('unauthorized') || error.message.includes('API key')) {
          throw new Error(
            `Daytona authentication failed. Please check your DAYTONA_API_KEY environment variable. Get your API key from https://daytona.io/`
          );
        }
        if (error.message.includes('quota') || error.message.includes('limit')) {
          throw new Error(
            `Daytona quota exceeded. Please check your usage at https://daytona.io/`
          );
        }
      }
      throw new Error(
        `Failed to create Daytona sandbox: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  async getById(sandboxId: string): Promise<Sandbox | null> {
    // Check if we have it in our active sandboxes
    const existing = this.activeSandboxes.get(sandboxId);
    if (existing) {
      return existing;
    }

    // Try to reconnect to existing Daytona session
    try {
      const session = await this.daytona.get(sandboxId);
      
      const sandbox = new DaytonaSandboxImpl(session, this.config.runtime || 'python');
      this.activeSandboxes.set(sandboxId, sandbox);
      
      return sandbox;
    } catch (error) {
      // Sandbox doesn't exist or can't be accessed
      return null;
    }
  }

  async list(): Promise<Sandbox[]> {
    try {
      // Use Daytona's list API to get all sandboxes
      const sessions = await this.daytona.list();
      const sandboxes: Sandbox[] = [];

      for (const session of sessions) {
        let sandbox = this.activeSandboxes.get(session.id);
        if (!sandbox) {
          sandbox = new DaytonaSandboxImpl(session, this.config.runtime || 'python');
          this.activeSandboxes.set(session.id, sandbox);
        }
        sandboxes.push(sandbox);
      }

      return sandboxes;
    } catch (error) {
      // If list fails, return our active sandboxes
      return Array.from(this.activeSandboxes.values());
    }
  }

  async destroy(sandboxId: string): Promise<void> {
    const sandbox = this.activeSandboxes.get(sandboxId);
    if (sandbox) {
      this.activeSandboxes.delete(sandboxId);
    }
    
    // Use Daytona client to delete the sandbox
    try {
      const session = await this.daytona.get(sandboxId);
      await this.daytona.delete(session);
    } catch (error) {
      // Sandbox might already be destroyed or doesn't exist
      // This is acceptable for destroy operations
    }
  }
}

/**
 * Daytona Provider implementation
 */
export class DaytonaProvider implements Provider {
  readonly name = 'daytona';
  readonly sandbox: ProviderSandboxManager;

  constructor(config: DaytonaConfig = {}) {
    this.sandbox = new DaytonaSandboxManager(config);
  }
}

/**
 * Create a Daytona provider instance
 */
export function daytona(config: DaytonaConfig = {}): DaytonaProvider {
  return new DaytonaProvider(config);
}