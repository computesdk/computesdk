import { FreestyleDevServer, FreestyleSandboxes } from "freestyle-sandboxes";
import type {
  ExecutionResult,
  Runtime,
  SandboxInfo,
  SandboxConfig,
  FileEntry,
  FilesystemComputeSpecification,
  FilesystemComputeSandbox,
} from '../../computesdk/src/types';
import { BaseProvider, BaseFileSystem } from '../../computesdk/src/providers/base';

interface FreestyleConfig extends Omit<SandboxConfig, 'provider'> {
  repoId?: string;
  apiKey?: string;
}

interface CreateRepositoryOptions {
  name: string;
  public?: boolean;
  source?: {
    url: string;
    type: 'git';
  };
}

/**
 * Freestyle FileSystem implementation using real dev server API
 */
class FreestyleFileSystem extends BaseFileSystem {
  constructor(
    provider: string,
    sandboxId: string,
    private getDevServer: () => Promise<FreestyleDevServer>
  ) {
    super(provider, sandboxId);
  }

  protected async doReadFile(path: string): Promise<string> {
    const devServer = await this.getDevServer();
    if (!devServer.fs) {
      throw new Error('Dev server filesystem not available');
    }
    try {
      return await devServer.fs.readFile(path, 'utf8');
    } catch (error) {
      throw new Error(`Failed to read file: File not found: ${path}`);
    }
  }

  protected async doWriteFile(path: string, content: string): Promise<void> {
    const devServer = await this.getDevServer();
    if (!devServer.fs) {
      throw new Error('Dev server filesystem not available');
    }
    await devServer.fs.writeFile(path, content, 'utf8');
  }

  protected async doMkdir(path: string): Promise<void> {
    const devServer = await this.getDevServer();
    if (!devServer.process) {
      throw new Error('Dev server process interface not available');
    }
    await devServer.process.exec(`mkdir -p "${path}"`);
  }

  protected async doReaddir(path: string): Promise<FileEntry[]> {
    const devServer = await this.getDevServer();
    if (!devServer.fs) {
      throw new Error('Dev server filesystem not available');
    }
    
    try {
      const files = await devServer.fs.ls(path);
      const entries: FileEntry[] = [];
      
      for (const fileName of files) {
        const fullPath = path === '/' ? `/${fileName}` : `${path}/${fileName}`;
        let isDirectory = false;
        let size = 0;
        
        // Check if it's a directory by trying to list it
        try {
          await devServer.fs.ls(fullPath);
          isDirectory = true;
        } catch {
          // If ls fails, it's likely a file, try to get its size
          try {
            const content = await devServer.fs.readFile(fullPath, 'utf8');
            size = content.length;
          } catch {
            // If we can't read it, assume it's a directory
            isDirectory = true;
          }
        }
        
        entries.push({
          name: fileName,
          path: fullPath,
          isDirectory,
          size,
          lastModified: new Date()
        });
      }
      
      return entries;
    } catch (error) {
      return [];
    }
  }

  protected async doExists(path: string): Promise<boolean> {
    try {
      await this.doReadFile(path);
      return true;
    } catch {
      try {
        const devServer = await this.getDevServer();
        if (!devServer.fs) {
          return false;
        }
        await devServer.fs.ls(path);
        return true;
      } catch {
        return false;
      }
    }
  }

  protected async doRemove(path: string): Promise<void> {
    const devServer = await this.getDevServer();
    if (!devServer.process) {
      throw new Error('Dev server process interface not available');
    }
    await devServer.process.exec(`rm -rf "${path}"`);
  }
}

export class FreestyleProvider extends BaseProvider implements FilesystemComputeSandbox, FilesystemComputeSpecification {
  private freestyle: FreestyleSandboxes;
  private readonly apiKey: string;
  private devServer: FreestyleDevServer | null = null;
  private readonly runtime: Runtime;
  private readonly repoId?: string;
  public readonly filesystem: FreestyleFileSystem;

  constructor(config: FreestyleConfig) {
    super('freestyle', config.timeout || 300000);
    
    // Explicitly check for API key in config first, then environment
    let apiKey = config.apiKey;
    if (!apiKey) {
      apiKey = process.env.FREESTYLE_API_KEY;
    }
    
    if (!apiKey || apiKey.trim() === '') {
      throw new Error('Missing Freestyle API key. Set FREESTYLE_API_KEY environment variable.');
    }
    
    this.apiKey = apiKey;
    this.runtime = config.runtime || 'node';
    this.repoId = config.repoId;

    this.freestyle = new FreestyleSandboxes({ apiKey: this.apiKey });
    this.filesystem = new FreestyleFileSystem(this.provider, this.sandboxId, () => this.ensureDevServer());
  }

  private async ensureDevServer(): Promise<FreestyleDevServer> {
    if (!this.devServer) {
      try {
        const requestOptions = this.repoId ? { repoId: this.repoId } : {};
        this.devServer = await this.freestyle.requestDevServer(requestOptions);
      } catch (error) {
        console.warn('Failed to create Freestyle dev server:', error);
        throw error;
      }
    }
    return this.devServer;
  }

  async doExecute(code: string, runtime?: Runtime): Promise<ExecutionResult> {
    const startTime = Date.now();
    
    try {
      const devServer = await this.ensureDevServer();
      
      // Determine the appropriate file extension and command based on runtime
      const actualRuntime = runtime || 'node';
      let fileExt: string;
      let execCommand: string;
      
      switch (actualRuntime) {
        case 'python':
          fileExt = 'py';
          execCommand = 'python3';
          break;
        case 'node':
          fileExt = 'js';
          execCommand = 'node';
          break;
        default:
          fileExt = 'js';
          execCommand = 'node';
      }
      
      // Create a temporary file to execute
      const tempFile = `/tmp/exec-${Date.now()}.${fileExt}`;
      await devServer.fs.writeFile(tempFile, code);
      
      // Execute the file
      const result = await devServer.process.exec(`${execCommand} ${tempFile}`);
      
      // Clean up
      await devServer.process.exec(`rm -f ${tempFile}`);
      
      return {
        executionTime: Date.now() - startTime,
        sandboxId: this.sandboxId,
        provider: this.provider,
        exitCode: (result.stderr?.length ?? 0) > 0 ? 1 : 0,
        stdout: result.stdout?.join('\n') ?? '',
        stderr: result.stderr?.join('\n') ?? '',
      };
    } catch (error) {
      throw error;
    }
  }

  /**
   * Kill the sandbox and clean up resources
   */
  public async doKill(): Promise<void> {
    if (this.devServer && this.devServer.shutdown) {
      try {
        await this.devServer.shutdown();
      } catch (error) {
        console.error('Error shutting down dev server:', error);
      } finally {
        this.devServer = null;
      }
    }
  }

  /**
   * Create a git repository using Freestyle
   */
  public async createGitRepository(options: CreateRepositoryOptions): Promise<{ repoId: string }> {
    const freestyleOptions: any = {
      name: options.name,
      public: options.public,
    };
    return await this.freestyle.createGitRepository(freestyleOptions);
  }

  /**
   * Get information about the sandbox
   */
  public async doGetInfo(): Promise<SandboxInfo> {
    return {
      id: this.sandboxId,
      provider: this.provider,
      runtime: this.runtime,
      status: this.devServer ? 'running' : 'stopped',
      createdAt: new Date(),
      timeout: this.timeout,
      metadata: {
        freestyleSessionId: this.sandboxId,
        repoId: this.repoId,
      },
    };
  }
}

export function freestyle(config?: Partial<FreestyleConfig>): FreestyleProvider {
  const fullConfig: FreestyleConfig = {
    runtime: 'node', // Default runtime to match tests
    timeout: 300000, // 5 minutes
    ...config
  };

  return new FreestyleProvider(fullConfig);
}