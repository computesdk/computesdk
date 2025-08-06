import type {
  ExecutionResult,
  Runtime,
  SandboxInfo,
  SandboxConfig,
  FileEntry,
  SandboxFileSystem,
  FilesystemComputeSpecification,
  FilesystemComputeSandbox,
} from 'computesdk';
import { BaseProvider, BaseFileSystem } from 'computesdk';
import { Daytona } from '@daytonaio/sdk';

/**
 * Daytona FileSystem implementation
 */
class DaytonaFileSystem extends BaseFileSystem {
  constructor(
    provider: string,
    sandboxId: string
  ) {
    super(provider, sandboxId);
  }

  protected async doReadFile(_path: string): Promise<string> {
    throw new Error('Daytona file read not implemented yet');
  }

  protected async doWriteFile(_path: string, _content: string): Promise<void> {
    throw new Error('Daytona file write not implemented yet');
  }

  protected async doMkdir(_path: string): Promise<void> {
    throw new Error('Daytona mkdir not implemented yet');
  }

  protected async doReaddir(_path: string): Promise<FileEntry[]> {
    throw new Error('Daytona readdir not implemented yet');
  }

  protected async doExists(_path: string): Promise<boolean> {
    return false;
  }

  protected async doRemove(_path: string): Promise<void> {
    throw new Error('Daytona remove not implemented yet');
  }
}

export class DaytonaProvider extends BaseProvider implements FilesystemComputeSandbox, FilesystemComputeSpecification {
  private daytona: Daytona;
  private sandbox: any | null = null;
  private readonly apiKey: string;
  private readonly runtime: Runtime;
  public readonly filesystem: SandboxFileSystem;

  constructor(config: SandboxConfig) {
    super('daytona', config.timeout || 300000);

    // Get API key from environment
    this.apiKey = process.env.DAYTONA_API_KEY || '';

    if (!this.apiKey) {
      throw new Error(
        `Missing Daytona API key. Set DAYTONA_API_KEY environment variable.`
      );
    }

    this.runtime = config.runtime || 'python';

    // Initialize Daytona client
    this.daytona = new Daytona({ apiKey: this.apiKey });

    // Initialize filesystem (no terminal support)
    this.filesystem = new DaytonaFileSystem(this.provider, this.sandboxId);
  }

  private async ensureSandbox(): Promise<any> {
    if (this.sandbox) {
      return this.sandbox;
    }

    try {
      // Create a new Daytona sandbox
      this.sandbox = await this.daytona.create({
        language: this.runtime === 'python' ? 'python' : 'typescript',
      });

      return this.sandbox;
    } catch (error) {
      if (error instanceof Error) {
        if (error.message.includes('unauthorized') || error.message.includes('API key')) {
          throw new Error(
            `Daytona authentication failed. Please check your DAYTONA_API_KEY environment variable.`
          );
        }
        if (error.message.includes('quota') || error.message.includes('limit')) {
          throw new Error(
            `Daytona quota exceeded. Please check your usage.`
          );
        }
      }
      throw new Error(
        `Failed to initialize Daytona sandbox: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  async doExecute(code: string, _runtime?: Runtime): Promise<ExecutionResult> {
    const sandbox = await this.ensureSandbox();

    try {
      // Execute code using Daytona's process.codeRun method
      const response = await sandbox.process.codeRun(code);
      
      return {
        stdout: response.result || '',
        stderr: response.error || '',
        exitCode: response.exitCode || 0,
        executionTime: 0, // BaseProvider will calculate this
        sandboxId: this.sandboxId,
        provider: this.provider
      };
    } catch (error) {
      return {
        stdout: '',
        stderr: error instanceof Error ? error.message : String(error),
        exitCode: 1,
        executionTime: 0,
        sandboxId: this.sandboxId,
        provider: this.provider
      };
    }
  }

  async doRunCommand(command: string, args: string[] = []): Promise<ExecutionResult> {
    const sandbox = await this.ensureSandbox();

    // Construct full command with arguments
    const fullCommand = args.length > 0 ? `${command} ${args.join(' ')}` : command;

    try {
      // Execute command using Daytona's process.executeCommand method
      const response = await sandbox.process.executeCommand(fullCommand);
      
      return {
        stdout: response.result || '',
        stderr: response.error || '',
        exitCode: response.exitCode || 0,
        executionTime: 0, // BaseProvider will calculate this
        sandboxId: this.sandboxId,
        provider: this.provider
      };
    } catch (error) {
      return {
        stdout: '',
        stderr: error instanceof Error ? error.message : String(error),
        exitCode: 1,
        executionTime: 0,
        sandboxId: this.sandboxId,
        provider: this.provider
      };
    }
  }

  async doKill(): Promise<void> {
    if (!this.sandbox) {
      return;
    }

    try {
      // Delete the Daytona sandbox
      await this.sandbox.delete();
      this.sandbox = null;
    } catch (error) {
      throw new Error(
        `Failed to kill Daytona sandbox: ${error instanceof Error ? error.message : String(error)}`
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
        daytonaSessionId: this.sandboxId
      }
    };
  }
}

export function daytona(config?: Partial<SandboxConfig>): DaytonaProvider {
  const fullConfig: SandboxConfig = {
    provider: 'auto' as any, // Use 'auto' as base type, actual provider is 'daytona'
    runtime: 'python',
    timeout: 300000,
    ...config
  };

  return new DaytonaProvider(fullConfig);
}