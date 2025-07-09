import type { 
  ComputeSpecification, 
  ExecutionResult, 
  Runtime, 
  SandboxInfo,
  SandboxConfig
} from 'computesdk';

// Vercel Sandbox API types
interface VercelSandboxAPI {
  createSandbox(config: {
    token: string;
    runtime: string;
  }): Promise<{
    id: string;
    execute: (code: string) => Promise<{
      stdout: string;
      stderr: string;
      exitCode: number;
    }>;
    close: () => Promise<void>;
  }>;
}

export class VercelProvider implements ComputeSpecification {
  public readonly specificationVersion = 'v1' as const;
  public readonly provider = 'vercel';
  public readonly sandboxId: string;
  
  private sandbox: any = null;
  private readonly token: string;
  private readonly runtime: Runtime;
  private readonly timeout: number;

  constructor(config: SandboxConfig) {
    this.sandboxId = `vercel-${Date.now()}-${Math.random().toString(36).substring(7)}`;
    this.timeout = config.timeout || 300000;
    
    // Get token from environment
    this.token = process.env.VERCEL_TOKEN || '';
    
    if (!this.token) {
      throw new Error(`Missing Vercel token. Set VERCEL_TOKEN environment variable.`);
    }
    
    // Validate runtime - Vercel supports Node.js and Python
    if (config.runtime && !['node', 'python'].includes(config.runtime)) {
      throw new Error('Vercel provider only supports Node.js and Python runtimes');
    }
    
    this.runtime = config.runtime || 'node';
  }

  private async ensureSandbox(): Promise<any> {
    if (this.sandbox) {
      return this.sandbox;
    }

    try {
      // TODO: Replace with actual Vercel Sandbox SDK when available
      // For now, this is a placeholder implementation
      this.sandbox = {
        id: this.sandboxId,
        execute: async (code: string) => {
          // Mock implementation
          return {
            stdout: `Executed in Vercel sandbox: ${code}`,
            stderr: '',
            exitCode: 0
          };
        },
        close: async () => {
          // Mock implementation
        }
      };
      
      return this.sandbox;
    } catch (error) {
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
      
      // Wrap code based on runtime
      let wrappedCode = code;
      if (actualRuntime === 'node') {
        wrappedCode = code;
      } else if (actualRuntime === 'python') {
        wrappedCode = `python -c "${code.replace(/"/g, '\\"')}"`;
      }
      
      const result = await sandbox.execute(wrappedCode);
      
      return {
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.exitCode,
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

  async doKill(): Promise<void> {
    if (!this.sandbox) {
      return;
    }

    try {
      await this.sandbox.close();
      this.sandbox = null;
    } catch (error) {
      throw new Error(
        `Failed to kill Vercel sandbox: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  async doGetInfo(): Promise<SandboxInfo> {
    const sandbox = await this.ensureSandbox();
    
    return {
      id: this.sandboxId,
      provider: this.provider,
      runtime: this.runtime,
      status: this.sandbox ? 'running' : 'stopped',
      createdAt: new Date(),
      timeout: this.timeout,
      metadata: {
        vercelSandboxId: sandbox.id,
        region: 'iad1' // Vercel sandboxes are currently only in iad1
      }
    };
  }
}

export function vercel(config?: Partial<SandboxConfig>): VercelProvider {
  const fullConfig: SandboxConfig = {
    provider: 'vercel',
    runtime: 'node',
    timeout: 300000,
    ...config
  };
  
  return new VercelProvider(fullConfig);
}