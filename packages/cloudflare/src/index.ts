import type { 
  BaseComputeSpecification,
  BaseComputeSandbox,
  ExecutionResult, 
  Runtime, 
  SandboxInfo,
  SandboxConfig,
  ContainerConfig
} from 'computesdk';
import { ExecutionError, TimeoutError } from 'computesdk';

// Cloudflare environment interface
export interface CloudflareEnv {
  Sandbox: DurableObjectNamespace;
}

// Type declarations for Cloudflare Workers
interface DurableObjectId {}
interface DurableObjectNamespace<T = any> {
  get(id: DurableObjectId): DurableObjectStub<T>;
  newUniqueId(): DurableObjectId;
  idFromName(name: string): DurableObjectId;
  idFromString(id: string): DurableObjectId;
  jurisdiction?: string;
}
interface DurableObjectStub<T = any> {
  fetch(request: Request): Promise<Response>;
  [key: string]: any;
}

// Platform detection
function isCloudflareWorker(): boolean {
  return typeof globalThis !== 'undefined' && 
         'WebSocketPair' in globalThis &&
         'caches' in globalThis;
}

export class CloudflareProvider implements BaseComputeSpecification, BaseComputeSandbox {
  public readonly specificationVersion = 'v1' as const;
  public readonly provider = 'cloudflare';
  public readonly sandboxId: string;
  
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