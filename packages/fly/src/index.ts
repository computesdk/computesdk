import type { 
  BaseComputeSpecification,
  BaseComputeSandbox, 
  ExecutionResult, 
  Runtime, 
  SandboxInfo,
  SandboxConfig,
  ContainerConfig
} from 'computesdk';

export class FlyProvider implements BaseComputeSpecification, BaseComputeSandbox {
  public readonly specificationVersion = 'v1' as const;
  public readonly provider = 'fly';
  public readonly sandboxId: string;
  
  private machine: any = null;
  private readonly apiToken: string;
  private readonly appName: string;
  private readonly containerConfig: ContainerConfig;
  private readonly timeout: number;

  constructor(config: SandboxConfig) {
    this.sandboxId = `fly-${Date.now()}-${Math.random().toString(36).substring(7)}`;
    this.timeout = config.timeout || 300000;
    
    // Get credentials from environment
    this.apiToken = process.env.FLY_API_TOKEN || '';
    this.appName = process.env.FLY_APP_NAME || 'computesdk-sandbox';
    
    if (!this.apiToken) {
      throw new Error(`Missing Fly.io API token. Set FLY_API_TOKEN environment variable.`);
    }
    
    // Fly.io requires container configuration
    if (!config.container) {
      throw new Error('Fly.io provider requires container configuration');
    }
    
    this.containerConfig = typeof config.container === 'string' 
      ? { image: config.container }
      : config.container;
  }

  private async ensureMachine(): Promise<any> {
    if (this.machine) {
      return this.machine;
    }

    try {
      // TODO: Replace with actual Fly.io Machines API
      // For now, this is a placeholder implementation
      this.machine = {
        id: this.sandboxId,
        execute: async (command: string) => {
          // Mock implementation
          return {
            stdout: `Executed on Fly.io machine: ${command}`,
            stderr: '',
            exitCode: 0
          };
        },
        stop: async () => {
          // Mock implementation
        },
        destroy: async () => {
          // Mock implementation
        }
      };
      
      return this.machine;
    } catch (error) {
      throw new Error(
        `Failed to initialize Fly.io machine: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  async doExecute(code: string, runtime?: Runtime): Promise<ExecutionResult> {
    const startTime = Date.now();
    
    try {
      const machine = await this.ensureMachine();
      
      // Build command based on runtime hint or container config
      let command = code;
      if (this.containerConfig.command) {
        command = `${this.containerConfig.command.join(' ')} -c "${code.replace(/"/g, '\\"')}"`;
      } else if (runtime === 'python') {
        command = `python -c "${code.replace(/"/g, '\\"')}"`;
      } else if (runtime === 'node') {
        command = `node -e "${code.replace(/"/g, '\\"')}"`;
      }
      
      const result = await machine.execute(command);
      
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
        `Fly.io execution failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  async doKill(): Promise<void> {
    if (!this.machine) {
      return;
    }

    try {
      await this.machine.stop();
      await this.machine.destroy();
      this.machine = null;
    } catch (error) {
      throw new Error(
        `Failed to kill Fly.io machine: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  async doGetInfo(): Promise<SandboxInfo> {
    const machine = await this.ensureMachine();
    
    return {
      id: this.sandboxId,
      provider: this.provider,
      runtime: 'container' as Runtime,
      status: this.machine ? 'running' : 'stopped',
      createdAt: new Date(),
      timeout: this.timeout,
      metadata: {
        flyMachineId: machine.id,
        image: this.containerConfig.image,
        appName: this.appName,
        region: this.containerConfig.env?.FLY_REGION || 'auto'
      }
    };
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

export function fly(config: Partial<SandboxConfig> & { container: string | ContainerConfig }): FlyProvider {
  const fullConfig: SandboxConfig = {
    provider: 'fly',
    timeout: 300000,
    ...config
  };
  
  return new FlyProvider(fullConfig);
}