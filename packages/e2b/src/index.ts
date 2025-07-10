import { Sandbox as E2BSandbox } from '@e2b/code-interpreter';
import type {
  ComputeSpecification,
  ExecutionResult,
  Runtime,
  SandboxInfo,
  SandboxConfig,
} from 'computesdk';

export class E2BProvider implements ComputeSpecification {
  public readonly specificationVersion = 'v1' as const;
  public readonly provider = 'e2b';
  public readonly sandboxId: string;

  private session: E2BSandbox | null = null;
  private readonly apiKey: string;
  private readonly runtime: Runtime;
  private readonly timeout: number;

  constructor(config: SandboxConfig) {
    this.sandboxId = `e2b-${Date.now()}-${Math.random().toString(36).substring(7)}`;
    this.timeout = config.timeout || 300000;

    // Get API key from environment
    this.apiKey = process.env.E2B_API_KEY || '';

    if (!this.apiKey) {
      throw new Error(
        `Missing E2B API key. Set E2B_API_KEY environment variable. Get your API key from https://e2b.dev/`
      );
    }

    // Validate API key format
    if (!this.apiKey.startsWith('e2b_')) {
      throw new Error(
        `Invalid E2B API key format. E2B API keys should start with 'e2b_'. Check your E2B_API_KEY environment variable.`
      );
    }

    this.runtime = config.runtime || 'python';
  }

  private async ensureSession(): Promise<E2BSandbox> {
    if (this.session) {
      return this.session;
    }

    try {
      // Create new E2B session with configuration
      this.session = await E2BSandbox.create({
        apiKey: this.apiKey,
        timeoutMs: this.timeout,
      });

      return this.session;
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
        `Failed to initialize E2B session: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  async doExecute(code: string, runtime?: Runtime): Promise<ExecutionResult> {
    const startTime = Date.now();

    try {
      const session = await this.ensureSession();

      // Execute code using E2B's runCode API
      const execution = await session.runCode(code);

      return {
        stdout: execution.logs.stdout.join('\n'),
        stderr: execution.logs.stderr.join('\n'),
        exitCode: execution.error ? 1 : 0,
        executionTime: Date.now() - startTime,
        sandboxId: this.sandboxId,
        provider: this.provider
      };
    } catch (error) {
      if (error instanceof Error) {
        if (error.message.includes('timeout')) {
          throw new Error(
            `E2B execution timeout (${this.timeout}ms). Consider increasing the timeout or optimizing your code.`
          );
        }
        if (error.message.includes('memory') || error.message.includes('Memory')) {
          throw new Error(
            `E2B execution failed due to memory limits. Consider optimizing your code or using smaller data sets.`
          );
        }
      }
      throw new Error(
        `E2B execution failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  async doKill(): Promise<void> {
    if (!this.session) {
      return;
    }

    try {
      await this.session.kill();
      this.session = null;
    } catch (error) {
      throw new Error(
        `Failed to kill E2B session: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  async doGetInfo(): Promise<SandboxInfo> {
    await this.ensureSession();

    return {
      id: this.sandboxId,
      provider: this.provider,
      runtime: this.runtime,
      status: this.session ? 'running' : 'stopped',
      createdAt: new Date(),
      timeout: this.timeout,
      metadata: {
        e2bSessionId: this.sandboxId
      }
    };
  }
}

export function e2b(config?: Partial<SandboxConfig>): E2BProvider {
  const fullConfig: SandboxConfig = {
    provider: 'e2b',
    runtime: 'python',
    timeout: 300000,
    ...config
  };

  return new E2BProvider(fullConfig);
}
