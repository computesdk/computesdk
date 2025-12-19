/**
 * Provider Factory - Creates providers from method definitions
 * 
 * Eliminates boilerplate by auto-generating Provider/Sandbox classes
 * from simple method definitions with automatic feature detection.
 */

import type {
  Provider,
  ProviderSandboxManager,
  ProviderTemplateManager,
  ProviderSnapshotManager,
  ProviderSandbox,
  SandboxFileSystem,
  SandboxInfo,
  CodeResult,
  CommandResult,
  Runtime,
  CreateSandboxOptions,
  FileEntry,
  RunCommandOptions,
  CreateSnapshotOptions,
  ListSnapshotsOptions,
  CreateTemplateOptions,
  ListTemplatesOptions,
} from './types/index.js';
import { cmd, type Command } from '@computesdk/cmd';

/**
 * Flat sandbox method implementations - all operations in one place
 */
export interface SandboxMethods<TSandbox = any, TConfig = any> {
  // Collection operations (map to compute.sandbox.*)
  create: (config: TConfig, options?: CreateSandboxOptions) => Promise<{ sandbox: TSandbox; sandboxId: string }>;
  getById: (config: TConfig, sandboxId: string) => Promise<{ sandbox: TSandbox; sandboxId: string } | null>;
  list: (config: TConfig) => Promise<Array<{ sandbox: TSandbox; sandboxId: string }>>;
  destroy: (config: TConfig, sandboxId: string) => Promise<void>;

  // Instance operations
  runCode: (sandbox: TSandbox, code: string, runtime?: Runtime, config?: TConfig) => Promise<CodeResult>;
  runCommand: (sandbox: TSandbox, command: string, args?: string[], options?: RunCommandOptions) => Promise<CommandResult>;
  getInfo: (sandbox: TSandbox) => Promise<SandboxInfo>;
  getUrl: (sandbox: TSandbox, options: { port: number; protocol?: string }) => Promise<string>;

  // Optional provider-specific typed getInstance method
  getInstance?: (sandbox: TSandbox) => TSandbox;

  // Optional filesystem methods
  filesystem?: {
    readFile: (sandbox: TSandbox, path: string, runCommand: (sandbox: TSandbox, command: string, args?: string[]) => Promise<CommandResult>) => Promise<string>;
    writeFile: (sandbox: TSandbox, path: string, content: string, runCommand: (sandbox: TSandbox, command: string, args?: string[]) => Promise<CommandResult>) => Promise<void>;
    mkdir: (sandbox: TSandbox, path: string, runCommand: (sandbox: TSandbox, command: string, args?: string[]) => Promise<CommandResult>) => Promise<void>;
    readdir: (sandbox: TSandbox, path: string, runCommand: (sandbox: TSandbox, command: string, args?: string[]) => Promise<CommandResult>) => Promise<FileEntry[]>;
    exists: (sandbox: TSandbox, path: string, runCommand: (sandbox: TSandbox, command: string, args?: string[]) => Promise<CommandResult>) => Promise<boolean>;
    remove: (sandbox: TSandbox, path: string, runCommand: (sandbox: TSandbox, command: string, args?: string[]) => Promise<CommandResult>) => Promise<void>;
  };
}

/**
 * Template method implementations
 */
export interface TemplateMethods<TTemplate = any, TConfig = any, TCreateOptions extends CreateTemplateOptions = CreateTemplateOptions> {
  create: (config: TConfig, options: TCreateOptions) => Promise<TTemplate>;
  list: (config: TConfig, options?: ListTemplatesOptions) => Promise<TTemplate[]>;
  delete: (config: TConfig, templateId: string) => Promise<void>;
}

/**
 * Snapshot method implementations  
 */
export interface SnapshotMethods<TSnapshot = any, TConfig = any> {
  create: (config: TConfig, sandboxId: string, options?: CreateSnapshotOptions) => Promise<TSnapshot>;
  list: (config: TConfig, options?: ListSnapshotsOptions) => Promise<TSnapshot[]>;
  delete: (config: TConfig, snapshotId: string) => Promise<void>;
}

/**
 * Provider execution modes
 *
 * - 'raw': Use raw provider methods directly (for gateway internal use)
 * - 'direct': Use provider's native SDK directly (for providers with sandbox capabilities)
 * - 'gateway': Route through ComputeSDK gateway (for providers without native sandbox)
 */
export type ProviderMode = 'raw' | 'direct' | 'gateway';

/**
 * Provider configuration for createProvider()
 */
export interface ProviderConfig<TSandbox = any, TConfig = any, TTemplate = any, TSnapshot = any> {
  name: string;
  /**
   * Default execution mode for this provider (defaults to 'gateway' if not specified)
   *
   * - 'direct': Provider has native sandbox capabilities (e.g., E2B) - uses provider SDK directly
   * - 'gateway': Provider only has infrastructure (e.g., Railway) - routes through gateway
   *
   * Can be overridden at runtime with `mode` in config.
   */
  defaultMode?: 'direct' | 'gateway';
  methods: {
    sandbox: SandboxMethods<TSandbox, TConfig>;
    template?: TemplateMethods<TTemplate, TConfig>;
    snapshot?: SnapshotMethods<TSnapshot, TConfig>;
  };
}

/**
 * Base config that all provider configs should extend
 * Includes the `mode` option for controlling execution mode
 */
export interface BaseProviderConfig {
  /**
   * Execution mode override
   *
   * - 'raw': Use raw provider methods directly (for gateway internal use)
   * - 'direct': Use provider's native SDK directly
   * - 'gateway': Route through ComputeSDK gateway
   *
   * If not specified, uses the provider's `defaultMode`.
   */
  mode?: ProviderMode;
}

/**
 * Auto-generated filesystem implementation that throws "not supported" errors
 */
class UnsupportedFileSystem implements SandboxFileSystem {
  private readonly providerName: string;

  constructor(providerName: string) {
    this.providerName = providerName;
  }

  async readFile(_path: string): Promise<string> {
    throw new Error(`Filesystem operations are not supported by ${this.providerName}'s sandbox environment. ${this.providerName} sandboxes are designed for code execution only.`);
  }

  async writeFile(_path: string, _content: string): Promise<void> {
    throw new Error(`Filesystem operations are not supported by ${this.providerName}'s sandbox environment. ${this.providerName} sandboxes are designed for code execution only.`);
  }

  async mkdir(_path: string): Promise<void> {
    throw new Error(`Filesystem operations are not supported by ${this.providerName}'s sandbox environment. ${this.providerName} sandboxes are designed for code execution only.`);
  }

  async readdir(_path: string): Promise<FileEntry[]> {
    throw new Error(`Filesystem operations are not supported by ${this.providerName}'s sandbox environment. ${this.providerName} sandboxes are designed for code execution only.`);
  }

  async exists(_path: string): Promise<boolean> {
    throw new Error(`Filesystem operations are not supported by ${this.providerName}'s sandbox environment. ${this.providerName} sandboxes are designed for code execution only.`);
  }

  async remove(_path: string): Promise<void> {
    throw new Error(`Filesystem operations are not supported by ${this.providerName}'s sandbox environment. ${this.providerName} sandboxes are designed for code execution only.`);
  }
}



/**
 * Auto-generated filesystem implementation that wraps provider methods
 */
class SupportedFileSystem<TSandbox> implements SandboxFileSystem {
  constructor(
    private sandbox: TSandbox,
    private methods: NonNullable<SandboxMethods<TSandbox>['filesystem']>,
    private allMethods: SandboxMethods<TSandbox>
  ) {}

  async readFile(path: string): Promise<string> {
    return this.methods.readFile(this.sandbox, path, this.allMethods.runCommand);
  }

  async writeFile(path: string, content: string): Promise<void> {
    return this.methods.writeFile(this.sandbox, path, content, this.allMethods.runCommand);
  }

  async mkdir(path: string): Promise<void> {
    return this.methods.mkdir(this.sandbox, path, this.allMethods.runCommand);
  }

  async readdir(path: string): Promise<FileEntry[]> {
    return this.methods.readdir(this.sandbox, path, this.allMethods.runCommand);
  }

  async exists(path: string): Promise<boolean> {
    return this.methods.exists(this.sandbox, path, this.allMethods.runCommand);
  }

  async remove(path: string): Promise<void> {
    return this.methods.remove(this.sandbox, path, this.allMethods.runCommand);
  }
}





/**
 * Generated sandbox class - implements the ProviderSandbox interface
 */
class GeneratedSandbox<TSandbox = any> implements ProviderSandbox<TSandbox> {
  readonly sandboxId: string;
  readonly provider: string;
  readonly filesystem: SandboxFileSystem;

  constructor(
    private sandbox: TSandbox,
    sandboxId: string,
    providerName: string,
    private methods: SandboxMethods<TSandbox>,
    private config: any,
    private destroyMethod: (config: any, sandboxId: string) => Promise<void>,
    private providerInstance: Provider
  ) {
    this.sandboxId = sandboxId;
    this.provider = providerName;

    // Auto-detect filesystem support
    if (methods.filesystem) {
      this.filesystem = new SupportedFileSystem(sandbox, methods.filesystem, methods);
    } else {
      this.filesystem = new UnsupportedFileSystem(providerName);
    }
  }

  getInstance(): TSandbox {
    // Use provider-specific typed getInstance if available
    if (this.methods.getInstance) {
      return this.methods.getInstance(this.sandbox);
    }
    // Fallback to returning the sandbox directly
    return this.sandbox;
  }

  async runCode(code: string, runtime?: Runtime): Promise<CodeResult> {
    return await this.methods.runCode(this.sandbox, code, runtime, this.config);
  }

  async runCommand(
    commandOrArray: string | [string, ...string[]],
    argsOrOptions?: string[] | RunCommandOptions,
    maybeOptions?: RunCommandOptions
  ): Promise<CommandResult> {
    // Parse overloaded arguments
    let command: string;
    let args: string[];
    let options: RunCommandOptions | undefined;

    if (Array.isArray(commandOrArray)) {
      // Array form: runCommand(['npm', 'install'], { cwd: '/app' })
      [command, ...args] = commandOrArray;
      options = argsOrOptions as RunCommandOptions | undefined;
    } else {
      // Traditional form: runCommand('npm', ['install'], { cwd: '/app' })
      command = commandOrArray;
      args = (Array.isArray(argsOrOptions) ? argsOrOptions : []) as string[];
      options = Array.isArray(argsOrOptions) ? maybeOptions : argsOrOptions as RunCommandOptions | undefined;
    }

    // Build the command tuple
    const baseCommand: Command = args.length > 0 ? [command, ...args] : [command];

    // Use cmd() helper to handle cwd and background options
    if (options?.cwd || options?.background) {
      const wrappedCommand = cmd(baseCommand, {
        cwd: options.cwd,
        background: options.background,
      });
      const [wrappedCmd, ...wrappedArgs] = wrappedCommand;
      return await this.methods.runCommand(this.sandbox, wrappedCmd, wrappedArgs, undefined);
    }

    return await this.methods.runCommand(this.sandbox, command, args, options);
  }

  async getInfo(): Promise<SandboxInfo> {
    return await this.methods.getInfo(this.sandbox);
  }

  async getUrl(options: { port: number; protocol?: string }): Promise<string> {
    return await this.methods.getUrl(this.sandbox, options);
  }

  getProvider(): Provider<TSandbox> {
    return this.providerInstance;
  }

  async kill(): Promise<void> {
    // For backward compatibility, kill() delegates to destroy()
    await this.destroy();
  }

  async destroy(): Promise<void> {
    // Destroy via the provider's destroy method using our sandboxId
    await this.destroyMethod(this.config, this.sandboxId);
  }
}

/**
 * Determines the effective execution mode
 *
 * @param config - Runtime config (may contain `mode` override)
 * @param defaultMode - Provider's default mode
 * @returns The effective execution mode
 */
function getEffectiveMode(config: BaseProviderConfig, defaultMode: 'direct' | 'gateway'): ProviderMode {
  // If mode is explicitly set in config, use it
  if (config.mode) {
    return config.mode;
  }

  // Otherwise use provider's default mode
  return defaultMode;
}

/**
 * Auto-generated Sandbox Manager implementation
 */
class GeneratedSandboxManager<TSandbox, TConfig> implements ProviderSandboxManager<TSandbox> {
  private readonly effectiveMode: ProviderMode;

  constructor(
    private config: TConfig,
    private providerName: string,
    private methods: SandboxMethods<TSandbox, TConfig>,
    private providerInstance: Provider,
    defaultMode: 'direct' | 'gateway'
  ) {
    this.effectiveMode = getEffectiveMode(config as BaseProviderConfig, defaultMode);
  }

  async create(options?: CreateSandboxOptions): Promise<ProviderSandbox<TSandbox>> {
    // Default to 'node' runtime if not specified for consistency across providers
    const optionsWithDefaults = { runtime: 'node' as Runtime, ...options };
    const result = await this.methods.create(this.config, optionsWithDefaults);
    
    return new GeneratedSandbox<TSandbox>(
      result.sandbox,
      result.sandboxId,
      this.providerName,
      this.methods,
      this.config,
      this.methods.destroy,
      this.providerInstance
    );
  }

  async getById(sandboxId: string): Promise<ProviderSandbox<TSandbox> | null> {
    const result = await this.methods.getById(this.config, sandboxId);
    if (!result) {
      return null;
    }

    return new GeneratedSandbox<TSandbox>(
      result.sandbox,
      result.sandboxId,
      this.providerName,
      this.methods,
      this.config,
      this.methods.destroy,
      this.providerInstance
    );
  }

  async list(): Promise<ProviderSandbox<TSandbox>[]> {
    const results = await this.methods.list(this.config);
    
    return results.map(result => new GeneratedSandbox<TSandbox>(
      result.sandbox,
      result.sandboxId,
      this.providerName,
      this.methods,
      this.config,
      this.methods.destroy,
      this.providerInstance
    ));
  }

  async destroy(sandboxId: string): Promise<void> {
    await this.methods.destroy(this.config, sandboxId);
  }
}

/**
 * Auto-generated Template Manager implementation
 */
class GeneratedTemplateManager<TTemplate, TConfig, TCreateOptions extends CreateTemplateOptions = CreateTemplateOptions> implements ProviderTemplateManager<TTemplate, TCreateOptions> {
  constructor(
    private config: TConfig,
    private methods: TemplateMethods<TTemplate, TConfig, TCreateOptions>
  ) {}

  async create(options: TCreateOptions): Promise<TTemplate> {
    return await this.methods.create(this.config, options);
  }

  async list(options?: ListTemplatesOptions): Promise<TTemplate[]> {
    return await this.methods.list(this.config, options);
  }

  async delete(templateId: string): Promise<void> {
    return await this.methods.delete(this.config, templateId);
  }
}

/**
 * Auto-generated Snapshot Manager implementation
 */
class GeneratedSnapshotManager<TSnapshot, TConfig> implements ProviderSnapshotManager<TSnapshot> {
  constructor(
    private config: TConfig,
    private methods: SnapshotMethods<TSnapshot, TConfig>
  ) {}

  async create(sandboxId: string, options?: CreateSnapshotOptions): Promise<TSnapshot> {
    return await this.methods.create(this.config, sandboxId, options);
  }

  async list(options?: ListSnapshotsOptions): Promise<TSnapshot[]> {
    return await this.methods.list(this.config, options);
  }

  async delete(snapshotId: string): Promise<void> {
    return await this.methods.delete(this.config, snapshotId);
  }
}

/**
 * Auto-generated Provider implementation
 */
class GeneratedProvider<TSandbox, TConfig, TTemplate, TSnapshot> implements Provider<TSandbox, TTemplate, TSnapshot> {
  readonly name: string;
  readonly sandbox: ProviderSandboxManager<TSandbox>;
  readonly template?: ProviderTemplateManager<TTemplate>;
  readonly snapshot?: ProviderSnapshotManager<TSnapshot>;

  constructor(config: TConfig, providerConfig: ProviderConfig<TSandbox, TConfig, TTemplate, TSnapshot>) {
    this.name = providerConfig.name;
    this.sandbox = new GeneratedSandboxManager(
      config,
      providerConfig.name,
      providerConfig.methods.sandbox,
      this,
      providerConfig.defaultMode ?? 'gateway'
    );

    // Initialize optional managers if methods are provided
    if (providerConfig.methods.template) {
      this.template = new GeneratedTemplateManager(config, providerConfig.methods.template);
    }
    
    if (providerConfig.methods.snapshot) {
      this.snapshot = new GeneratedSnapshotManager(config, providerConfig.methods.snapshot);
    }
  }

  getSupportedRuntimes(): Runtime[] {
    // For now, all providers support both node and python
    // In the future, this could be configurable per provider
    return ['node', 'python'];
  }
}

/**
 * Create a provider from method definitions
 *
 * Auto-generates all boilerplate classes and provides feature detection
 * based on which methods are implemented.
 */
export function createProvider<TSandbox, TConfig = any, TTemplate = any, TSnapshot = any>(
  providerConfig: ProviderConfig<TSandbox, TConfig, TTemplate, TSnapshot>
): (config: TConfig) => Provider<TSandbox, TTemplate, TSnapshot> {
  return (config: TConfig) => {
    return new GeneratedProvider(config, providerConfig);
  };
}