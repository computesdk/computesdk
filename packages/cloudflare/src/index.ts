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
import { ExecutionError, TimeoutError, BaseFileSystem } from 'computesdk';

// Cloudflare environment interface
export interface CloudflareEnv {
  Sandbox: DurableObjectNamespace;
}

// Type declarations for Cloudflare Workers
interface DurableObjectId {}
interface DurableObjectNamespace {
  get(id: DurableObjectId): DurableObjectStub;
  newUniqueId(): DurableObjectId;
  idFromName(name: string): DurableObjectId;
  idFromString(id: string): DurableObjectId;
  jurisdiction?: string;
}
interface DurableObjectStub {
  fetch(request: Request): Promise<Response>;
  [key: string]: any;
}

// Platform detection
function isCloudflareWorker(): boolean {
  return typeof globalThis !== 'undefined' && 
         'WebSocketPair' in globalThis &&
         'caches' in globalThis;
}

/**
 * Cloudflare FileSystem implementation using native Cloudflare sandbox methods
 */
class CloudflareFileSystem extends BaseFileSystem {
  constructor(
    provider: string,
    sandboxId: string,
    private getSandbox: () => Promise<DurableObjectStub>
  ) {
    super(provider, sandboxId);
  }

  protected async doReadFile(path: string): Promise<string> {
    const sandbox = await this.getSandbox();
    const result = await (sandbox as any).readFile(path, { encoding: 'utf8' });
    
    // Handle both streaming and non-streaming responses
    if (typeof result === 'string') {
      return result;
    }
    
    // If it's a streaming response, collect the data
    let content = '';
    const reader = result.getReader();
    const decoder = new TextDecoder();
    
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        content += decoder.decode(value, { stream: true });
      }
      content += decoder.decode(); // Flush any remaining bytes
      return content;
    } finally {
      reader.releaseLock();
    }
  }

  protected async doWriteFile(path: string, content: string): Promise<void> {
    const sandbox = await this.getSandbox();
    await (sandbox as any).writeFile(path, content, { encoding: 'utf8' });
  }

  protected async doMkdir(path: string): Promise<void> {
    const sandbox = await this.getSandbox();
    await (sandbox as any).mkdir(path, { recursive: true });
  }

  protected async doReaddir(path: string): Promise<FileEntry[]> {
    const sandbox = await this.getSandbox();
    
    // Use ls command to list directory contents
    const result = await (sandbox as any).exec('ls', ['-la', '--time-style=iso', path]);
    
    // Parse ls output to create FileEntry objects
    const lines = result.stdout.split('\n').filter((line: string) => line.trim());
    const entries: FileEntry[] = [];
    
    // Skip the first line (total) and process each file/directory
    for (let i = 1; i < lines.length; i++) {
      const line: string = lines[i].trim();
      if (!line) continue;
      
      // Parse ls -la output: permissions links owner group size date time name
      const parts = line.split(/\s+/);
      if (parts.length < 8) continue;
      
      const permissions = parts[0];
      const isDirectory = permissions.startsWith('d');
      const size = parseInt(parts[4]) || 0;
      const dateStr = parts[5] + ' ' + parts[6];
      const name = parts.slice(7).join(' '); // Handle names with spaces
      
      // Skip current and parent directory entries
      if (name === '.' || name === '..') continue;
      
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
      const result = await (sandbox as any).exec('test', ['-e', path]);
      return result.exitCode === 0;
    } catch (error) {
      return false;
    }
  }

  protected async doRemove(path: string): Promise<void> {
    const sandbox = await this.getSandbox();
    await (sandbox as any).deleteFile(path);
  }
}

export class CloudflareProvider implements FilesystemComputeSpecification, FilesystemComputeSandbox {
  public readonly specificationVersion = 'v1' as const;
  public readonly provider = 'cloudflare';
  public readonly sandboxId: string;
  public readonly filesystem: SandboxFileSystem;
  
  private sandbox: DurableObjectStub | null = null;
  private readonly env: CloudflareEnv;
  private readonly timeout: number;

  constructor(config: SandboxConfig & { env: CloudflareEnv }) {
    // Platform check
    if (!isCloudflareWorker()) {
      throw new Error(
        'Cloudflare provider can only be used within Cloudflare Workers environment. ' +
        'Deploy your code to Cloudflare Workers or use a universal provider like E2B or Vercel.'
      );
    }
    
    if (!config.env?.Sandbox) {
      throw new Error(
        'Cloudflare provider requires env.Sandbox (Durable Object namespace). ' +
        'Make sure your wrangler.toml includes the Sandbox durable object binding.'
      );
    }
    
    this.sandboxId = `cloudflare-${Date.now()}-${Math.random().toString(36).substring(7)}`;
    this.timeout = config.timeout || 300000;
    this.env = config.env;
    
    // Initialize filesystem
    this.filesystem = new CloudflareFileSystem(this.provider, this.sandboxId, () => this.ensureSandbox());
  }

  private async ensureSandbox(): Promise<DurableObjectStub> {
    if (this.sandbox) {
      return this.sandbox;
    }

    try {
      const { getSandbox } = await import('@cloudflare/sandbox');
      const sandbox = getSandbox(this.env.Sandbox as any, this.sandboxId);
      this.sandbox = sandbox;
      return sandbox;
    } catch (error) {
      throw new ExecutionError(
        `Failed to initialize Cloudflare sandbox: ${error instanceof Error ? error.message : String(error)}`,
        this.provider,
        1,
        this.sandboxId
      );
    }
  }

  async doExecute(code: string, runtime?: Runtime): Promise<ExecutionResult> {
    const startTime = Date.now();
    
    try {
      const sandbox = await this.ensureSandbox();
      
      // Determine the command based on runtime
      let command: string;
      let args: string[];
      
      if (runtime === 'python' || runtime === undefined) {
        command = 'python3';
        args = ['-c', code];
      } else if (runtime === 'node') {
        command = 'node';
        args = ['-e', code];
      } else {
        throw new ExecutionError(
          `Unsupported runtime: ${runtime}. Cloudflare sandbox supports python and node.`,
          this.provider,
          1,
          this.sandboxId
        );
      }
      
      // Set up timeout
      let timeoutReached = false;
      const timeoutId = setTimeout(() => {
        timeoutReached = true;
      }, this.timeout);
      
      try {
        // Execute without streaming to get ExecuteResponse
        const result = await sandbox.exec(command, args);
        clearTimeout(timeoutId);
        
        if (timeoutReached) {
          throw new TimeoutError(
            `Execution timed out after ${this.timeout}ms`,
            this.provider,
            this.timeout,
            this.sandboxId
          );
        }
        
        // Type assertion since we know exec returns ExecuteResponse when not streaming
        const execResult = result as any;
        
        return {
          stdout: execResult.stdout || '',
          stderr: execResult.stderr || '',
          exitCode: execResult.exitCode || 0,
          executionTime: Date.now() - startTime,
          sandboxId: this.sandboxId,
          provider: this.provider
        };
      } catch (execError) {
        clearTimeout(timeoutId);
        if (timeoutReached) {
          throw new TimeoutError(
            `Execution timed out after ${this.timeout}ms`,
            this.provider,
            this.timeout,
            this.sandboxId
          );
        }
        throw execError;
      }
    } catch (error) {
      if (error instanceof ExecutionError || error instanceof TimeoutError) {
        throw error;
      }
      throw new ExecutionError(
        `Cloudflare execution failed: ${error instanceof Error ? error.message : String(error)}`,
        this.provider,
        1,
        this.sandboxId
      );
    }
  }

  async doKill(): Promise<void> {
    // Cloudflare sandboxes are ephemeral and managed by the platform
    // They automatically clean up after the Worker request completes
    this.sandbox = null;
  }

  async doGetInfo(): Promise<SandboxInfo> {
    return {
      id: this.sandboxId,
      provider: this.provider,
      runtime: 'python' as Runtime, // Default runtime
      status: this.sandbox ? 'running' : 'stopped',
      createdAt: new Date(),
      timeout: this.timeout,
      metadata: {
        platform: 'cloudflare-workers',
        sandboxType: 'durable-object'
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
      
      // Set up timeout
      let timeoutReached = false;
      const timeoutId = setTimeout(() => {
        timeoutReached = true;
      }, this.timeout);
      
      try {
        // Execute command directly using Cloudflare's exec
        const result = await sandbox.exec(command, args);
        clearTimeout(timeoutId);
        
        if (timeoutReached) {
          throw new TimeoutError(
            `Command execution timed out after ${this.timeout}ms`,
            this.provider,
            this.timeout,
            this.sandboxId
          );
        }
        
        // Type assertion since we know exec returns ExecuteResponse when not streaming
        const execResult = result as any;
        
        return {
          stdout: execResult.stdout || '',
          stderr: execResult.stderr || '',
          exitCode: execResult.exitCode || 0,
          executionTime: Date.now() - startTime,
          sandboxId: this.sandboxId,
          provider: this.provider
        };
      } catch (execError) {
        clearTimeout(timeoutId);
        if (timeoutReached) {
          throw new TimeoutError(
            `Command execution timed out after ${this.timeout}ms`,
            this.provider,
            this.timeout,
            this.sandboxId
          );
        }
        throw execError;
      }
    } catch (error) {
      if (error instanceof ExecutionError || error instanceof TimeoutError) {
        throw error;
      }
      throw new ExecutionError(
        `Cloudflare command execution failed: ${error instanceof Error ? error.message : String(error)}`,
        this.provider,
        1,
        this.sandboxId
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

export function cloudflare(config: Partial<SandboxConfig> & { env: CloudflareEnv }): CloudflareProvider {
  const fullConfig: SandboxConfig & { env: CloudflareEnv } = {
    provider: 'cloudflare',
    timeout: 300000,
    ...config
  };
  
  return new CloudflareProvider(fullConfig);
}