/**
 * Gateway Provider Factory
 * 
 * Creates thin wrappers that route all operations through the ComputeSDK gateway.
 * Used for infrastructure providers (Railway, Vercel, etc.) to provide a user-facing
 * API that feels like a first-class provider.
 */

import type {
  Runtime,
  CreateSandboxOptions,
  FileEntry,
  RunCommandOptions,
  Provider,
  ProviderSandboxManager,
  ProviderSandbox,
  SandboxInfo,
  CodeResult,
  CommandResult,
  SandboxFileSystem,
  FindOrCreateSandboxOptions,
  FindSandboxOptions,
  ExtendTimeoutOptions,
} from './types/index.js';

/**
 * Gateway provider configuration
 */
export interface GatewayProviderConfig {
  /** Provider name (must match gateway provider name) */
  name: string;
}

/**
 * Gateway configuration passed to providers
 * This gets merged with provider-specific config
 */
export interface GatewayConfig {
  /** ComputeSDK API key for gateway authentication */
  apiKey?: string;
  /** Gateway URL override */
  gatewayUrl?: string;
}

/**
 * Import compute singleton dynamically to avoid circular dependencies
 */
async function getComputeSingleton(): Promise<any> {
  try {
    // Dynamic import to avoid bundling issues
    const computeModule = await import('computesdk');
    return computeModule.compute;
  } catch (error) {
    throw new Error(
      'Failed to import compute singleton from "computesdk" package. ' +
      'Make sure "computesdk" is installed: npm install computesdk'
    );
  }
}

/**
 * Sandbox wrapper that routes all operations through gateway
 */
class GatewaySandbox implements ProviderSandbox {
  readonly sandboxId: string;
  readonly provider: string;
  readonly filesystem: SandboxFileSystem;

  constructor(
    private gatewaySandbox: any,
    private providerInstance: Provider
  ) {
    this.sandboxId = gatewaySandbox.sandboxId;
    this.provider = gatewaySandbox.provider;
    this.filesystem = gatewaySandbox.filesystem;
  }

  getInstance(): any {
    return this.gatewaySandbox;
  }

  async runCode(code: string, runtime?: Runtime): Promise<CodeResult> {
    return await this.gatewaySandbox.runCode(code, runtime);
  }

  async runCommand(
    commandOrArray: string | [string, ...string[]],
    argsOrOptions?: string[] | RunCommandOptions,
    maybeOptions?: RunCommandOptions
  ): Promise<CommandResult> {
    return await this.gatewaySandbox.runCommand(commandOrArray, argsOrOptions, maybeOptions);
  }

  async getInfo(): Promise<SandboxInfo> {
    return await this.gatewaySandbox.getInfo();
  }

  async getUrl(options: { port: number; protocol?: string }): Promise<string> {
    return await this.gatewaySandbox.getUrl(options);
  }

  getProvider(): Provider {
    return this.providerInstance;
  }

  async destroy(): Promise<void> {
    await this.gatewaySandbox.destroy();
  }
}

/**
 * Sandbox manager that routes through gateway compute singleton
 */
class GatewaySandboxManager implements ProviderSandboxManager {
  constructor(
    private providerName: string,
    private providerConfig: any,
    private providerInstance: Provider
  ) {}

  async create(options?: CreateSandboxOptions): Promise<ProviderSandbox> {
    const compute = await getComputeSingleton();
    
    // Set config with provider-specific settings
    compute.setConfig({
      provider: this.providerName,
      apiKey: this.providerConfig.apiKey,
      gatewayUrl: this.providerConfig.gatewayUrl,
      [this.providerName]: this.providerConfig,
    });

    // Create sandbox via gateway
    const gatewaySandbox = await compute.sandbox.create(options);
    
    return new GatewaySandbox(gatewaySandbox, this.providerInstance);
  }

  async getById(sandboxId: string): Promise<ProviderSandbox | null> {
    const compute = await getComputeSingleton();
    
    compute.setConfig({
      provider: this.providerName,
      apiKey: this.providerConfig.apiKey,
      gatewayUrl: this.providerConfig.gatewayUrl,
      [this.providerName]: this.providerConfig,
    });

    const gatewaySandbox = await compute.sandbox.getById(sandboxId);
    
    if (!gatewaySandbox) {
      return null;
    }

    return new GatewaySandbox(gatewaySandbox, this.providerInstance);
  }

  async list(): Promise<ProviderSandbox[]> {
    const compute = await getComputeSingleton();
    
    compute.setConfig({
      provider: this.providerName,
      apiKey: this.providerConfig.apiKey,
      gatewayUrl: this.providerConfig.gatewayUrl,
      [this.providerName]: this.providerConfig,
    });

    const gatewaySandboxes = await compute.sandbox.list();
    
    return gatewaySandboxes.map((s: any) => new GatewaySandbox(s, this.providerInstance));
  }

  async destroy(sandboxId: string): Promise<void> {
    const compute = await getComputeSingleton();
    
    compute.setConfig({
      provider: this.providerName,
      apiKey: this.providerConfig.apiKey,
      gatewayUrl: this.providerConfig.gatewayUrl,
      [this.providerName]: this.providerConfig,
    });

    await compute.sandbox.destroy(sandboxId);
  }

  async findOrCreate(options: FindOrCreateSandboxOptions): Promise<ProviderSandbox> {
    const compute = await getComputeSingleton();
    
    compute.setConfig({
      provider: this.providerName,
      apiKey: this.providerConfig.apiKey,
      gatewayUrl: this.providerConfig.gatewayUrl,
      [this.providerName]: this.providerConfig,
    });

    const gatewaySandbox = await compute.sandbox.findOrCreate(options);
    
    return new GatewaySandbox(gatewaySandbox, this.providerInstance);
  }

  async find(options: FindSandboxOptions): Promise<ProviderSandbox | null> {
    const compute = await getComputeSingleton();
    
    compute.setConfig({
      provider: this.providerName,
      apiKey: this.providerConfig.apiKey,
      gatewayUrl: this.providerConfig.gatewayUrl,
      [this.providerName]: this.providerConfig,
    });

    const gatewaySandbox = await compute.sandbox.find(options);
    
    if (!gatewaySandbox) {
      return null;
    }

    return new GatewaySandbox(gatewaySandbox, this.providerInstance);
  }

  async extendTimeout(sandboxId: string, options?: ExtendTimeoutOptions): Promise<void> {
    const compute = await getComputeSingleton();
    
    compute.setConfig({
      provider: this.providerName,
      apiKey: this.providerConfig.apiKey,
      gatewayUrl: this.providerConfig.gatewayUrl,
      [this.providerName]: this.providerConfig,
    });

    await compute.sandbox.extendTimeout(sandboxId, options);
  }
}

/**
 * Gateway provider implementation
 */
class GatewayProvider implements Provider {
  readonly name: string;
  readonly sandbox: ProviderSandboxManager;

  constructor(providerConfig: any, config: GatewayProviderConfig) {
    this.name = config.name;
    this.sandbox = new GatewaySandboxManager(config.name, providerConfig, this);
  }

  getSupportedRuntimes(): Runtime[] {
    // Gateway providers support all runtimes through the daemon
    return ['node', 'python'];
  }
}

/**
 * Create a gateway provider from configuration
 * 
 * Gateway providers route all operations through the ComputeSDK gateway.
 * They provide a first-class provider experience for infrastructure providers
 * like Railway, Vercel, etc.
 * 
 * @example
 * ```typescript
 * // Define gateway provider
 * export const railway = defineGatewayProvider<RailwayConfig>({
 *   name: 'railway'
 * });
 * 
 * // User usage:
 * const provider = railway({ 
 *   apiKey: 'railway_xxx',
 *   projectId: 'project_xxx',
 *   environmentId: 'env_xxx'
 * });
 * 
 * // Full sandbox API - all routes through gateway
 * const sandbox = await provider.sandbox.create();
 * await sandbox.runCode('console.log("hello")');
 * ```
 */
export function defineGatewayProvider<TConfig extends GatewayConfig = GatewayConfig>(
  config: GatewayProviderConfig
): (providerConfig: TConfig) => Provider {
  return (providerConfig: TConfig) => {
    return new GatewayProvider(providerConfig, config);
  };
}
