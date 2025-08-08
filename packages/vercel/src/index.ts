import { Sandbox } from '@vercel/sandbox';
import ms from 'ms';
import type {
  FilesystemComputeSpecification,
  FilesystemComputeSandbox,
  ExecutionResult,
  Runtime,
  SandboxInfo,
  SandboxConfig,
  FileEntry,
  SandboxFileSystem
} from 'computesdk';
import { BaseProvider, BaseFileSystem } from 'computesdk';

/**
 * Vercel-specific configuration options
 */
export interface VercelConfig extends SandboxConfig {
  /** Vercel API token - if not provided, will fallback to VERCEL_TOKEN environment variable */
  token?: string;
  /** Vercel team ID - if not provided, will fallback to VERCEL_TEAM_ID environment variable */
  teamId?: string;
  /** Vercel project ID - if not provided, will fallback to VERCEL_PROJECT_ID environment variable */
  projectId?: string;
  /** Existing sandbox ID to reconnect to - if not provided, will create a new sandbox */
  sandboxId?: string;
}

/**
 * Vercel FileSystem implementation using shell commands
 */
class VercelFileSystem extends BaseFileSystem {
  constructor(
    provider: string,
    sandboxId: string,
    private getSandbox: () => Promise<any>
  ) {
    super(provider, sandboxId);
  }

  protected async doReadFile(path: string): Promise<string> {
    const sandbox = await this.getSandbox();

    // Use cat command to read file contents
    const result = await sandbox.runCommand({
      cmd: 'cat',
      args: [path],
    });

    // Handle the new Vercel Sandbox API format
    let content = '';
    let exitCode = result.exitCode ?? 0;

    // Get stdout by calling the function
    if (result.stdout && typeof result.stdout === 'function') {
      try {
        const stdoutResult = await result.stdout();
        content = stdoutResult || '';
      } catch (error) {
        console.warn('Failed to get stdout:', error);
      }
    }

    // Check exit code
    if (exitCode !== 0) {
      throw new Error(`Failed to read file ${path}: exit code ${exitCode}`);
    }
    return content;
  }

  protected async doWriteFile(path: string, content: string): Promise<void> {
    const sandbox = await this.getSandbox();

    // Create directory if it doesn't exist
    const dir = path.substring(0, path.lastIndexOf('/'));
    if (dir) {
      await this.doMkdir(dir);
    }

    // Use echo to write file contents (escape content for shell)
    const escapedContent = content.replace(/'/g, "'\"'\"'");
    const result = await sandbox.runCommand({
      cmd: 'sh',
      args: ['-c', `echo '${escapedContent}' > '${path}'`],
    });

    // Check exit code
    const exitCode = result.exitCode ?? 0;
    if (exitCode !== 0) {
      throw new Error(`Failed to write file ${path}: exit code ${exitCode}`);
    }
  }

  protected async doMkdir(path: string): Promise<void> {
    const sandbox = await this.getSandbox();

    // Use mkdir -p to create directory and parents
    const result = await sandbox.runCommand({
      cmd: 'mkdir',
      args: ['-p', path],
    });

    // Check exit code
    const exitCode = result.exitCode ?? 0;
    if (exitCode !== 0) {
      throw new Error(`Failed to create directory ${path}: exit code ${exitCode}`);
    }
  }

  protected async doReaddir(path: string): Promise<FileEntry[]> {
    const sandbox = await this.getSandbox();

    // Use ls -la to list directory contents with details
    const result = await sandbox.runCommand({
      cmd: 'ls',
      args: ['-la', '--time-style=iso', path],
    });

    // Handle the new Vercel Sandbox API format
    let output = '';
    let exitCode = result.exitCode ?? 0;

    // Get stdout by calling the function
    if (result.stdout && typeof result.stdout === 'function') {
      try {
        const stdoutResult = await result.stdout();
        output = stdoutResult || '';
      } catch (error) {
        console.warn('Failed to get stdout:', error);
      }
    }

    // Check exit code
    if (exitCode !== 0) {
      throw new Error(`Failed to read directory ${path}: exit code ${exitCode}`);
    }

    // Parse ls output to create FileEntry objects
    const lines = output.split('\n').filter((line: string) => line.trim());
    const entries: FileEntry[] = [];

    // Skip the first line (total) and process each file/directory
    for (let i = 1; i < lines.length; i++) {
      const line: string = lines[i].trim();
      if (!line || line === '.' || line === '..') continue;

      // Parse ls -la output: permissions links owner group size date time name
      const parts = line.split(/\s+/);
      if (parts.length < 8) continue;

      const permissions = parts[0];
      const isDirectory = permissions.startsWith('d');
      const size = parseInt(parts[4]) || 0;
      const dateStr = parts[5] + ' ' + parts[6];
      const name = parts.slice(7).join(' '); // Handle names with spaces
      const fullPath = path.endsWith('/') ? path + name : path + '/' + name;

      entries.push({
        name,
        path: fullPath,
        isDirectory,
        size,
        lastModified: new Date(dateStr)
      });
    }

    return entries;
  }

  protected async doExists(path: string): Promise<boolean> {
    const sandbox = await this.getSandbox();

    try {
      // Use test command to check if file/directory exists
      const result = await sandbox.runCommand({
        cmd: 'test',
        args: ['-e', path],
      });

      // Get exit code from result
      const exitCode = result.exitCode ?? 1;

      return exitCode === 0;
    } catch (error) {
      return false;
    }
  }

  protected async doRemove(path: string): Promise<void> {
    const sandbox = await this.getSandbox();

    // Use rm -rf to remove file or directory
    const result = await sandbox.runCommand({
      cmd: 'rm',
      args: ['-rf', path],
    });

    // Check exit code
    const exitCode = result.exitCode ?? 0;
    if (exitCode !== 0) {
      throw new Error(`Failed to remove ${path}: exit code ${exitCode}`);
    }
  }
}

export class VercelProvider extends BaseProvider implements FilesystemComputeSpecification, FilesystemComputeSandbox {
  public sandboxId: string;
  public readonly filesystem: SandboxFileSystem;

  private sandbox: any = null;
  private readonly token: string;
  private readonly teamId: string;
  private readonly projectId: string;
  private readonly runtime: Runtime;
  private readonly configuredSandboxId?: string;

  constructor(config: VercelConfig) {
    super('vercel', config.timeout || 300000);
    
    this.configuredSandboxId = config.sandboxId;
    // Start with configured ID or placeholder - will be updated when sandbox is created
    this.sandboxId = config.sandboxId || 'vercel-pending';

    // Get authentication from config or environment
    this.token = config.token || (typeof process !== 'undefined' && process.env?.VERCEL_TOKEN) || '';
    this.teamId = config.teamId || (typeof process !== 'undefined' && process.env?.VERCEL_TEAM_ID) || '';
    this.projectId = config.projectId || (typeof process !== 'undefined' && process.env?.VERCEL_PROJECT_ID) || '';

    if (!this.token) {
      throw new Error(
        `Missing Vercel token. Provide 'token' in config or set VERCEL_TOKEN environment variable. Get your token from https://vercel.com/account/tokens`
      );
    }

    if (!this.teamId) {
      throw new Error(
        `Missing Vercel team ID. Provide 'teamId' in config or set VERCEL_TEAM_ID environment variable.`
      );
    }

    if (!this.projectId) {
      throw new Error(
        `Missing Vercel project ID. Provide 'projectId' in config or set VERCEL_PROJECT_ID environment variable.`
      );
    }

    // Validate runtime - Vercel supports Node.js and Python
    if (config.runtime && !['node', 'python'].includes(config.runtime)) {
      throw new Error('Vercel provider only supports Node.js and Python runtimes');
    }

    this.runtime = config.runtime || 'node';

    // Initialize filesystem
    this.filesystem = new VercelFileSystem(this.provider, this.sandboxId, () => this.ensureSandbox());
  }

  private async ensureSandbox(): Promise<any> {
    if (this.sandbox) {
      return this.sandbox;
    }

    try {
      if (this.configuredSandboxId) {
        // Reconnect to existing sandbox using provided sandboxId
        this.sandbox = await Sandbox.get({
          sandboxId: this.configuredSandboxId,
          token: this.token,
          teamId: this.teamId,
          projectId: this.projectId,
        });
        this.sandboxId = this.configuredSandboxId;
      } else {
        // Create new Vercel Sandbox with appropriate runtime
        const runtimeImage = this.runtime === 'node' ? 'node22' : 'python3.13';

        this.sandbox = await Sandbox.create({
          token: this.token,
          teamId: this.teamId,
          projectId: this.projectId,
          runtime: runtimeImage,
          timeout: ms(`${this.timeout}ms`),
          resources: { vcpus: 2 }, // Default to 2 vCPUs
        });

        // Update sandboxId with the actual Vercel sandbox ID
        this.sandboxId = this.sandbox.sandboxId;
      }

      return this.sandbox;
    } catch (error) {
      if (error instanceof Error) {
        if (error.message.includes('unauthorized') || error.message.includes('token')) {
          throw new Error(
            `Vercel authentication failed. Please check your VERCEL_TOKEN environment variable. Get your token from https://vercel.com/account/tokens`
          );
        }
        if (error.message.includes('team') || error.message.includes('project')) {
          throw new Error(
            `Vercel team/project configuration error. Please check your VERCEL_TEAM_ID and VERCEL_PROJECT_ID environment variables.`
          );
        }
        if (error.message.includes('Memory limit exceeded')) {
          throw new Error(
            `Vercel execution failed due to memory limits. Consider optimizing your code or using smaller data sets.`
          );
        }
        if (error.message.includes('quota') || error.message.includes('limit')) {
          throw new Error(
            `Vercel quota exceeded. Please check your usage in the Vercel dashboard.`
          );
        }
      }
      throw new Error(
        `Failed to initialize Vercel sandbox: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  async doExecute(code: string, runtime?: Runtime): Promise<ExecutionResult> {
    // Validate runtime
    if (runtime && !['node', 'python'].includes(runtime)) {
      throw new Error('Vercel provider only supports Node.js and Python runtimes');
    }

    const startTime = Date.now();
    const actualRuntime = runtime || this.runtime;

    try {
      const sandbox = await this.ensureSandbox();

      // Execute code based on runtime
      let command: string;
      let args: string[] = [];

      if (actualRuntime === 'node') {
        // For Node.js, use node -e to execute code directly
        command = 'node';
        args = ['-e', code];
      } else if (actualRuntime === 'python') {
        // For Python, use python -c to execute code directly
        command = 'python';
        args = ['-c', code];
      } else {
        throw new Error(`Unsupported runtime: ${actualRuntime}`);
      }

      // Execute the command in the sandbox
      const result = await sandbox.runCommand({
        cmd: command,
        args: args,
      });

      // Handle the new Vercel Sandbox API format
      let stdout = '';
      let stderr = '';
      let exitCode = result.exitCode ?? 0;

      // Get stdout and stderr by calling the functions
      if (result.stdout && typeof result.stdout === 'function') {
        try {
          const stdoutResult = await result.stdout();
          stdout = stdoutResult || '';
        } catch (error) {
          console.warn('Failed to get stdout:', error);
        }
      }

      if (result.stderr && typeof result.stderr === 'function') {
        try {
          const stderrResult = await result.stderr();
          stderr = stderrResult || '';
        } catch (error) {
          console.warn('Failed to get stderr:', error);
        }
      }

      return {
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        exitCode: exitCode,
        executionTime: Date.now() - startTime,
        sandboxId: this.sandboxId,
        provider: this.provider
      };
    } catch (error) {
      if (error instanceof Error) {
        if (error.message.includes('timeout')) {
          throw new Error(
            `Vercel execution timeout (${this.timeout}ms). Consider increasing the timeout or optimizing your code.`
          );
        }
        if (error.message.includes('memory') || error.message.includes('Memory')) {
          throw new Error(
            `Vercel execution failed due to memory limits. Consider optimizing your code or using smaller data sets.`
          );
        }
      }
      throw new Error(
        `Vercel execution failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  async doKill(): Promise<void> {
    if (!this.sandbox) {
      return;
    }

    try {
      await this.sandbox.stop();
      this.sandbox = null;
    } catch (error) {
      throw new Error(
        `Failed to kill Vercel sandbox: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  async doGetInfo(): Promise<SandboxInfo> {
    await this.ensureSandbox();

    return {
      id: this.sandboxId,
      provider: this.provider,
      runtime: this.runtime,
      status: this.sandbox ? 'running' : 'stopped',
      createdAt: new Date(),
      timeout: this.timeout,
      metadata: {
        vercelSandboxId: this.sandboxId,
        teamId: this.teamId,
        projectId: this.projectId,
        vcpus: 2, // Default vCPUs
        region: 'global' // Vercel sandboxes can run globally
      }
    };
  }

  async runCode(code: string, runtime?: Runtime): Promise<ExecutionResult> {
    return this.doExecute(code, runtime);
  }

  async runCommand(command: string, args: string[] = []): Promise<ExecutionResult> {
    const startTime = Date.now();

    try {
      const sandbox = await this.ensureSandbox();

      // Execute command directly using Vercel's runCommand
      const result = await sandbox.runCommand({
        cmd: command,
        args: args,
      });

      // Handle the new Vercel Sandbox API format
      let stdout = '';
      let stderr = '';
      let exitCode = result.exitCode ?? 0;

      // Get stdout and stderr by calling the functions
      if (result.stdout && typeof result.stdout === 'function') {
        try {
          const stdoutResult = await result.stdout();
          stdout = stdoutResult || '';
        } catch (error) {
          console.warn('Failed to get stdout:', error);
        }
      }

      if (result.stderr && typeof result.stderr === 'function') {
        try {
          const stderrResult = await result.stderr();
          stderr = stderrResult || '';
        } catch (error) {
          console.warn('Failed to get stderr:', error);
        }
      }

      return {
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        exitCode: exitCode,
        executionTime: Date.now() - startTime,
        sandboxId: this.sandboxId,
        provider: this.provider
      };
    } catch (error) {
      if (error instanceof Error) {
        if (error.message.includes('timeout')) {
          throw new Error(
            `Vercel command timeout (${this.timeout}ms). Consider increasing the timeout or optimizing your command.`
          );
        }
        if (error.message.includes('memory') || error.message.includes('Memory')) {
          throw new Error(
            `Vercel command failed due to memory limits. Consider optimizing your command.`
          );
        }
      }
      throw new Error(
        `Vercel command execution failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  // Public methods for BaseComputeSandbox interface
  async execute(code: string, runtime?: Runtime): Promise<ExecutionResult> {
    return this.doExecute(code, runtime);
  }

  async kill(): Promise<void> {
    return this.doKill();
  }

  async getInfo(): Promise<SandboxInfo> {
    return this.doGetInfo();
  }
}

export function vercel(config?: Partial<VercelConfig>): VercelProvider {
  const fullConfig: VercelConfig = {
    provider: 'vercel',
    runtime: 'node',
    timeout: 300000,
    ...config
  };

  return new VercelProvider(fullConfig);
}
