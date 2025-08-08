import { Sandbox as VercelSandbox } from '@vercel/sandbox';
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
 * Vercel-specific configuration options
 */
export interface VercelConfig {
  /** Vercel API token - if not provided, will fallback to VERCEL_TOKEN environment variable */
  token?: string;
  /** Vercel team ID - if not provided, will fallback to VERCEL_TEAM_ID environment variable */
  teamId?: string;
  /** Vercel project ID - if not provided, will fallback to VERCEL_PROJECT_ID environment variable */
  projectId?: string;
  /** Default runtime environment */
  runtime?: Runtime;
  /** Execution timeout in milliseconds */
  timeout?: number;
}

/**
 * Vercel Sandbox implementation
 */
class VercelSandboxImpl implements Sandbox {
  readonly sandboxId: string;
  readonly provider = 'vercel';
  readonly filesystem: SandboxFileSystem;
  readonly terminal: SandboxTerminal;

  private session: VercelSandbox;
  private readonly runtime: Runtime;

  constructor(session: VercelSandbox, runtime: Runtime = 'node') {
    this.session = session;
    this.sandboxId = session.sandboxId;
    this.runtime = runtime;
    
    // Initialize filesystem and terminal
    this.filesystem = new VercelFileSystem(this.session);
    this.terminal = new VercelTerminal(this.session);
  }

  async runCode(code: string, runtime?: Runtime): Promise<ExecutionResult> {
    const startTime = Date.now();
    const effectiveRuntime = runtime || this.runtime;

    try {
      let result;
      
      if (effectiveRuntime === 'python') {
        // Execute Python code
        result = await this.session.runCommand('python3', ['-c', code]);
      } else {
        // Execute Node.js code
        result = await this.session.runCommand('node', ['-e', code]);
      }
      
      return {
        stdout: await this.getCommandOutput(result.stdout) || '',
        stderr: await this.getCommandOutput(result.stderr) || '',
        exitCode: result.exitCode || 0,
        executionTime: Date.now() - startTime,
        sandboxId: this.sandboxId,
        provider: this.provider
      };
    } catch (error) {
      throw new Error(
        `Vercel execution failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  async runCommand(command: string, args: string[] = []): Promise<ExecutionResult> {
    const startTime = Date.now();

    try {
      const result = await this.session.runCommand(command, args);
      
      return {
        stdout: await this.getCommandOutput(result.stdout) || '',
        stderr: await this.getCommandOutput(result.stderr) || '',
        exitCode: result.exitCode || 0,
        executionTime: Date.now() - startTime,
        sandboxId: this.sandboxId,
        provider: this.provider
      };
    } catch (error) {
      throw new Error(
        `Vercel command execution failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  private async getCommandOutput(stream: any): Promise<string> {
    if (!stream) return '';
    
    // Handle different stream types from Vercel SDK
    if (typeof stream === 'function') {
      try {
        return await stream() || '';
      } catch (error) {
        return '';
      }
    }
    
    if (typeof stream === 'string') {
      return stream;
    }
    
    return '';
  }

  async getInfo(): Promise<SandboxInfo> {
    return {
      id: this.sandboxId,
      provider: this.provider,
      runtime: this.runtime,
      status: 'running', // Vercel sandboxes are running when accessible
      createdAt: new Date(),
      timeout: 300000, // Default Vercel timeout
      metadata: {
        vercelSandboxId: this.sandboxId
      }
    };
  }

  async kill(): Promise<void> {
    try {
      await this.session.stop();
    } catch (error) {
      throw new Error(
        `Failed to kill Vercel session: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
}

/**
 * Vercel FileSystem implementation
 */
class VercelFileSystem implements SandboxFileSystem {
  constructor(private session: VercelSandbox) {}

  async readFile(path: string): Promise<string> {
    throw new Error('Filesystem operations are not supported by Vercel\'s sandbox environment. Vercel sandboxes are designed for code execution only.');
  }

  async writeFile(path: string, content: string): Promise<void> {
    throw new Error('Filesystem operations are not supported by Vercel\'s sandbox environment. Vercel sandboxes are designed for code execution only.');
  }

  async mkdir(path: string): Promise<void> {
    throw new Error('Filesystem operations are not supported by Vercel\'s sandbox environment. Vercel sandboxes are designed for code execution only.');
  }

  async readdir(path: string): Promise<FileEntry[]> {
    throw new Error('Filesystem operations are not supported by Vercel\'s sandbox environment. Vercel sandboxes are designed for code execution only.');
  }

  async exists(path: string): Promise<boolean> {
    throw new Error('Filesystem operations are not supported by Vercel\'s sandbox environment. Vercel sandboxes are designed for code execution only.');
  }

  async remove(path: string): Promise<void> {
    throw new Error('Filesystem operations are not supported by Vercel\'s sandbox environment. Vercel sandboxes are designed for code execution only.');
  }
}

/**
 * Vercel Terminal implementation (Note: Vercel supports command execution but not persistent terminals)
 */
class VercelTerminal implements SandboxTerminal {
  constructor(private session: VercelSandbox) {}

  async create(options: TerminalCreateOptions = {}): Promise<TerminalSession> {
    throw new Error('Interactive terminal sessions are not supported by Vercel\'s sandbox environment. Vercel sandboxes only support individual command execution.');
  }

  async list(): Promise<TerminalSession[]> {
    throw new Error('Interactive terminal sessions are not supported by Vercel\'s sandbox environment. Vercel sandboxes only support individual command execution.');
  }
}

/**
 * Vercel Sandbox Manager - implements ProviderSandboxManager
 */
class VercelSandboxManager implements ProviderSandboxManager {
  private activeSandboxes: Map<string, VercelSandboxImpl> = new Map();

  constructor(private config: VercelConfig) {
    // Validate required environment variables
    const token = config.token || (typeof process !== 'undefined' && process.env?.VERCEL_TOKEN) || '';
    const teamId = config.teamId || (typeof process !== 'undefined' && process.env?.VERCEL_TEAM_ID) || '';
    const projectId = config.projectId || (typeof process !== 'undefined' && process.env?.VERCEL_PROJECT_ID) || '';
    
    if (!token) {
      throw new Error(
        `Missing Vercel token. Provide 'token' in config or set VERCEL_TOKEN environment variable. Get your token from https://vercel.com/account/tokens`
      );
    }
    
    if (!teamId) {
      throw new Error(
        `Missing Vercel team ID. Provide 'teamId' in config or set VERCEL_TEAM_ID environment variable.`
      );
    }
    
    if (!projectId) {
      throw new Error(
        `Missing Vercel project ID. Provide 'projectId' in config or set VERCEL_PROJECT_ID environment variable.`
      );
    }
  }

  async create(options?: CreateSandboxOptions): Promise<Sandbox> {
    const runtime = options?.runtime || this.config.runtime || 'node';
    const timeout = this.config.timeout || 300000;

    try {
      let session: VercelSandbox;

      if (options?.sandboxId) {
        // Reconnect to existing Vercel sandbox
        session = await VercelSandbox.get({
          sandboxId: options.sandboxId,
          token: this.config.token || process.env.VERCEL_TOKEN!,
          teamId: this.config.teamId || process.env.VERCEL_TEAM_ID!,
          projectId: this.config.projectId || process.env.VERCEL_PROJECT_ID!,
        });
      } else {
        // Create new Vercel sandbox
        session = await VercelSandbox.create({
          runtime: runtime === 'python' ? 'python3.13' : 'node22',
          timeout,
          token: this.config.token || process.env.VERCEL_TOKEN!,
          teamId: this.config.teamId || process.env.VERCEL_TEAM_ID!,
          projectId: this.config.projectId || process.env.VERCEL_PROJECT_ID!,
        });
      }

      const sandbox = new VercelSandboxImpl(session, runtime);
      this.activeSandboxes.set(sandbox.sandboxId, sandbox);
      
      return sandbox;
    } catch (error) {
      if (error instanceof Error) {
        if (error.message.includes('unauthorized') || error.message.includes('token')) {
          throw new Error(
            `Vercel authentication failed. Please check your VERCEL_TOKEN environment variable. Get your token from https://vercel.com/account/tokens`
          );
        }
        if (error.message.includes('team') || error.message.includes('project')) {
          throw new Error(
            `Vercel team/project configuration failed. Please check your VERCEL_TEAM_ID and VERCEL_PROJECT_ID environment variables.`
          );
        }
        if (error.message.includes('quota') || error.message.includes('limit')) {
          throw new Error(
            `Vercel quota exceeded. Please check your usage at https://vercel.com/dashboard`
          );
        }
      }
      throw new Error(
        `Failed to create Vercel sandbox: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  async getById(sandboxId: string): Promise<Sandbox | null> {
    // Check if we have it in our active sandboxes
    const existing = this.activeSandboxes.get(sandboxId);
    if (existing) {
      return existing;
    }

    // Try to reconnect to existing Vercel sandbox
    try {
      const session = await VercelSandbox.get({
        sandboxId,
        token: this.config.token || process.env.VERCEL_TOKEN!,
        teamId: this.config.teamId || process.env.VERCEL_TEAM_ID!,
        projectId: this.config.projectId || process.env.VERCEL_PROJECT_ID!,
      });
      
      const sandbox = new VercelSandboxImpl(session, this.config.runtime || 'node');
      this.activeSandboxes.set(sandboxId, sandbox);
      
      return sandbox;
    } catch (error) {
      // Sandbox doesn't exist or can't be accessed
      return null;
    }
  }

  async list(): Promise<Sandbox[]> {
    // Vercel doesn't have a native list API, so we return our active sandboxes
    // In a real implementation, you might want to store sandbox IDs in a database
    return Array.from(this.activeSandboxes.values());
  }

  async destroy(sandboxId: string): Promise<void> {
    const sandbox = this.activeSandboxes.get(sandboxId);
    if (sandbox) {
      await sandbox.kill();
      this.activeSandboxes.delete(sandboxId);
    }
    
    // If not in our active list, try to connect and stop
    try {
      const session = await VercelSandbox.get({
        sandboxId,
        token: this.config.token || process.env.VERCEL_TOKEN!,
        teamId: this.config.teamId || process.env.VERCEL_TEAM_ID!,
        projectId: this.config.projectId || process.env.VERCEL_PROJECT_ID!,
      });
      await session.stop();
    } catch (error) {
      // Sandbox might already be destroyed or doesn't exist
      // This is acceptable for destroy operations
    }
  }
}

/**
 * Vercel Provider implementation
 */
export class VercelProvider implements Provider {
  readonly name = 'vercel';
  readonly sandbox: ProviderSandboxManager;

  constructor(config: VercelConfig = {}) {
    // Validate runtime if provided
    if (config.runtime && !['node', 'python'].includes(config.runtime)) {
      throw new Error('Vercel provider only supports Node.js and Python runtimes');
    }
    
    this.sandbox = new VercelSandboxManager(config);
  }
}

/**
 * Create a Vercel provider instance
 */
export function vercel(config: VercelConfig = {}): VercelProvider {
  return new VercelProvider(config);
}