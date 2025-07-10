import { Sandbox } from '@vercel/sandbox';
import ms from 'ms';
import type {
  ComputeSpecification,
  ExecutionResult,
  Runtime,
  SandboxInfo,
  SandboxConfig
} from 'computesdk';

export class VercelProvider implements ComputeSpecification {
  public readonly specificationVersion = 'v1' as const;
  public readonly provider = 'vercel';
  public readonly sandboxId: string;

  private sandbox: any = null;
  private readonly token: string;
  private readonly teamId: string;
  private readonly projectId: string;
  private readonly runtime: Runtime;
  private readonly timeout: number;

  constructor(config: SandboxConfig) {
    this.sandboxId = `vercel-${Date.now()}-${Math.random().toString(36).substring(7)}`;
    this.timeout = config.timeout || 300000;

    // Get authentication from environment
    this.token = process.env.VERCEL_TOKEN || '';
    this.teamId = process.env.VERCEL_TEAM_ID || '';
    this.projectId = process.env.VERCEL_PROJECT_ID || '';

    if (!this.token) {
      throw new Error(
        `Missing Vercel token. Set VERCEL_TOKEN environment variable. Get your token from https://vercel.com/account/tokens`
      );
    }

    if (!this.teamId) {
      throw new Error(
        `Missing Vercel team ID. Set VERCEL_TEAM_ID environment variable.`
      );
    }

    if (!this.projectId) {
      throw new Error(
        `Missing Vercel project ID. Set VERCEL_PROJECT_ID environment variable.`
      );
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
      // Create Vercel Sandbox with appropriate runtime
      const runtimeImage = this.runtime === 'node' ? 'node22' : 'python3.13';

      this.sandbox = await Sandbox.create({
        runtime: runtimeImage,
        timeout: ms(`${this.timeout}ms`),
        resources: { vcpus: 2 }, // Default to 2 vCPUs
      });

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

      // Collect stdout and stderr streams
      let stdout = '';
      let stderr = '';
      let exitCode = 0;

      // Set up stream listeners
      const stdoutPromise = new Promise<void>((resolve) => {
        if (result.stdout) {
          result.stdout.on('data', (data: Buffer) => {
            stdout += data.toString();
          });
          result.stdout.on('end', resolve);
        } else {
          resolve();
        }
      });

      const stderrPromise = new Promise<void>((resolve) => {
        if (result.stderr) {
          result.stderr.on('data', (data: Buffer) => {
            stderr += data.toString();
          });
          result.stderr.on('end', resolve);
        } else {
          resolve();
        }
      });

      // Wait for the process to complete
      const exitPromise = new Promise<number>((resolve, reject) => {
        result.on('exit', (code: number) => {
          exitCode = code;
          resolve(code);
        });
        result.on('error', reject);
      });

      // Wait for all streams to complete
      await Promise.all([stdoutPromise, stderrPromise, exitPromise]);

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
