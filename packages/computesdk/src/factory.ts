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
  Sandbox,
  SandboxFileSystem,
  SandboxInfo,
  ExecutionResult,
  Runtime,
  CreateSandboxOptions,
  FileEntry,
  RunCommandOptions,
  CreateSnapshotOptions,
  ListSnapshotsOptions,
  CreateTemplateOptions,
  ListTemplatesOptions,
} from './types/index.js';

/**
 * Helper function to handle background command execution
 * Providers can use this to implement background job support
 */
export function createBackgroundCommand(command: string, args: string[] = [], options?: RunCommandOptions): { command: string; args: string[]; isBackground: boolean } {
  if (!options?.background) {
    return { command, args, isBackground: false };
  }

  // For background execution, we modify the command to run in background
  // Default approach: append & to make it run in background
  const fullCommand = args.length > 0 ? `${command} ${args.join(' ')}` : command;
  
  return {
    command: 'sh',
    args: ['-c', `${fullCommand} &`],
    isBackground: true
  };
}

/**
 * Flat sandbox method implementations - all operations in one place
 */
export interface SandboxMethods<TSandbox = any, TConfig = any> {
  // Collection operations (map to compute.sandbox.*)
  create: (config: TConfig, options?: CreateSandboxOptions) => Promise<{ sandbox: TSandbox; sandboxId: string }>;
  getById: (config: TConfig, sandboxId: string) => Promise<{ sandbox: TSandbox; sandboxId: string } | null>;
  list: (config: TConfig) => Promise<Array<{ sandbox: TSandbox; sandboxId: string }>>;
  destroy: (config: TConfig, sandboxId: string) => Promise<void>;
  
  // Instance operations (map to individual Sandbox methods)
  runCode: (sandbox: TSandbox, code: string, runtime?: Runtime, config?: TConfig) => Promise<ExecutionResult>;
  runCommand: (sandbox: TSandbox, command: string, args?: string[], options?: RunCommandOptions) => Promise<ExecutionResult>;
  getInfo: (sandbox: TSandbox) => Promise<SandboxInfo>;
  getUrl: (sandbox: TSandbox, options: { port: number; protocol?: string }) => Promise<string>;
  
  // Optional provider-specific typed getInstance method
  getInstance?: (sandbox: TSandbox) => TSandbox;
  
  // Optional filesystem methods
  filesystem?: {
    readFile: (sandbox: TSandbox, path: string, runCommand: (sandbox: TSandbox, command: string, args?: string[]) => Promise<ExecutionResult>) => Promise<string>;
    writeFile: (sandbox: TSandbox, path: string, content: string, runCommand: (sandbox: TSandbox, command: string, args?: string[]) => Promise<ExecutionResult>) => Promise<void>;
    mkdir: (sandbox: TSandbox, path: string, runCommand: (sandbox: TSandbox, command: string, args?: string[]) => Promise<ExecutionResult>) => Promise<void>;
    readdir: (sandbox: TSandbox, path: string, runCommand: (sandbox: TSandbox, command: string, args?: string[]) => Promise<ExecutionResult>) => Promise<FileEntry[]>;
    exists: (sandbox: TSandbox, path: string, runCommand: (sandbox: TSandbox, command: string, args?: string[]) => Promise<ExecutionResult>) => Promise<boolean>;
    remove: (sandbox: TSandbox, path: string, runCommand: (sandbox: TSandbox, command: string, args?: string[]) => Promise<ExecutionResult>) => Promise<void>;
  };
}

/**
 * Template method implementations
 */
export interface TemplateMethods<TTemplate = any, TConfig = any> {
  create: (config: TConfig, options: CreateTemplateOptions | any) => Promise<TTemplate>;
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
 * Provider configuration for createProvider()
 */
export interface ProviderConfig<TSandbox = any, TConfig = any, TTemplate = any, TSnapshot = any> {
  name: string;
  methods: {
    sandbox: SandboxMethods<TSandbox, TConfig>;
    template?: TemplateMethods<TTemplate, TConfig>;
    snapshot?: SnapshotMethods<TSnapshot, TConfig>;
  };
}

/**
 * Default filesystem implementations based on shell commands
 * These work for any provider that supports shell command execution
 */
const defaultFilesystemMethods = {
  readFile: async (sandbox: any, path: string, runCommand: (sandbox: any, command: string, args?: string[]) => Promise<ExecutionResult>): Promise<string> => {
    const result = await runCommand(sandbox, 'cat', [path]);
    if (result.exitCode !== 0) {
      throw new Error(`Failed to read file ${path}: ${result.stderr}`);
    }
    // Trim trailing newline that cat command adds
    return result.stdout.replace(/\n$/, '');
  },

  writeFile: async (sandbox: any, path: string, content: string, runCommand: (sandbox: any, command: string, args?: string[]) => Promise<ExecutionResult>): Promise<void> => {
    const result = await runCommand(sandbox, 'sh', ['-c', `echo ${JSON.stringify(content)} > ${JSON.stringify(path)}`]);
    if (result.exitCode !== 0) {
      throw new Error(`Failed to write file ${path}: ${result.stderr}`);
    }
  },

  mkdir: async (sandbox: any, path: string, runCommand: (sandbox: any, command: string, args?: string[]) => Promise<ExecutionResult>): Promise<void> => {
    const result = await runCommand(sandbox, 'mkdir', ['-p', path]);
    if (result.exitCode !== 0) {
      throw new Error(`Failed to create directory ${path}: ${result.stderr}`);
    }
  },

  readdir: async (sandbox: any, path: string, runCommand: (sandbox: any, command: string, args?: string[]) => Promise<ExecutionResult>): Promise<FileEntry[]> => {
    // Try different ls variations for maximum compatibility
    let result = await runCommand(sandbox, 'ls', ['-la', path]);
    let hasDetailedOutput = true;
    
    // Fall back to basic ls if detailed flags not supported
    if (result.exitCode !== 0) {
      result = await runCommand(sandbox, 'ls', ['-l', path]);
    }
    if (result.exitCode !== 0) {
      result = await runCommand(sandbox, 'ls', [path]);
      hasDetailedOutput = false;
    }
    
    if (result.exitCode !== 0) {
      throw new Error(`Failed to list directory ${path}: ${result.stderr}`);
    }

    const lines = (result.stdout || '').split('\n').filter((line: string) => line.trim() && !line.startsWith('total'));

    return lines.map((line: string) => {
      if (hasDetailedOutput && line.includes(' ')) {
        // Parse detailed ls output (ls -la or ls -l)
        const parts = line.trim().split(/\s+/);
        const name = parts[parts.length - 1];
        const isDirectory = line.startsWith('d');
        
        return {
          name,
          path: `${path}/${name}`,
          isDirectory,
          size: parseInt(parts[4]) || 0,
          lastModified: new Date()
        };
      } else {
        // Parse simple ls output (just filenames)
        const name = line.trim();
        return {
          name,
          path: `${path}/${name}`,
          isDirectory: false, // Can't determine from simple ls
          size: 0,
          lastModified: new Date()
        };
      }
    });
  },

  exists: async (sandbox: any, path: string, runCommand: (sandbox: any, command: string, args?: string[]) => Promise<ExecutionResult>): Promise<boolean> => {
    const result = await runCommand(sandbox, 'test', ['-e', path]);
    return result.exitCode === 0; // Exit code 0 means file exists
  },

  remove: async (sandbox: any, path: string, runCommand: (sandbox: any, command: string, args?: string[]) => Promise<ExecutionResult>): Promise<void> => {
    const result = await runCommand(sandbox, 'rm', ['-rf', path]);
    if (result.exitCode !== 0) {
      throw new Error(`Failed to remove ${path}: ${result.stderr}`);
    }
  }
};

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
 * Generated sandbox class - implements the Sandbox interface
 */
class GeneratedSandbox<TSandbox = any> implements Sandbox<TSandbox> {
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

  async runCode(code: string, runtime?: Runtime): Promise<ExecutionResult> {
    return await this.methods.runCode(this.sandbox, code, runtime, this.config);
  }

  async runCommand(command: string, args?: string[], options?: RunCommandOptions): Promise<ExecutionResult> {
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
 * Auto-generated Sandbox Manager implementation
 */
class GeneratedSandboxManager<TSandbox, TConfig> implements ProviderSandboxManager<TSandbox> {
  private activeSandboxes: Map<string, GeneratedSandbox<TSandbox>> = new Map();

  constructor(
    private config: TConfig,
    private providerName: string,
    private methods: SandboxMethods<TSandbox, TConfig>,
    private providerInstance: Provider
  ) {}

  async create(options?: CreateSandboxOptions): Promise<Sandbox<TSandbox>> {
    // Default to 'node' runtime if not specified for consistency across providers
    const optionsWithDefaults = { runtime: 'node' as Runtime, ...options };
    const result = await this.methods.create(this.config, optionsWithDefaults);
    const sandbox = new GeneratedSandbox<TSandbox>(
      result.sandbox,
      result.sandboxId,
      this.providerName,
      this.methods,
      this.config,
      this.methods.destroy,
      this.providerInstance
    );
    
    this.activeSandboxes.set(result.sandboxId, sandbox);
    return sandbox;
  }

  async getById(sandboxId: string): Promise<Sandbox<TSandbox> | null> {
    // Check active sandboxes first
    const existing = this.activeSandboxes.get(sandboxId);
    if (existing) {
      return existing;
    }

    // Try to reconnect
    const result = await this.methods.getById(this.config, sandboxId);
    if (!result) {
      return null;
    }

    const sandbox = new GeneratedSandbox<TSandbox>(
      result.sandbox,
      result.sandboxId,
      this.providerName,
      this.methods,
      this.config,
      this.methods.destroy,
      this.providerInstance
    );
    
    this.activeSandboxes.set(result.sandboxId, sandbox);
    return sandbox;
  }

  async list(): Promise<Sandbox<TSandbox>[]> {
    const results = await this.methods.list(this.config);
    const sandboxes: Sandbox[] = [];

    for (const result of results) {
      let sandbox = this.activeSandboxes.get(result.sandboxId);
      if (!sandbox) {
        sandbox = new GeneratedSandbox<TSandbox>(
          result.sandbox,
          result.sandboxId,
          this.providerName,
          this.methods,
          this.config,
          this.methods.destroy,
          this.providerInstance
        );
        this.activeSandboxes.set(result.sandboxId, sandbox);
      }
      sandboxes.push(sandbox);
    }

    return sandboxes;
  }

  async destroy(sandboxId: string): Promise<void> {
    await this.methods.destroy(this.config, sandboxId);
    this.activeSandboxes.delete(sandboxId);
  }
}

/**
 * Auto-generated Template Manager implementation
 */
class GeneratedTemplateManager<TTemplate, TConfig> implements ProviderTemplateManager<TTemplate> {
  constructor(
    private config: TConfig,
    private methods: TemplateMethods<TTemplate, TConfig>
  ) {}

  async create(options: CreateTemplateOptions | any): Promise<TTemplate> {
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
  readonly __sandboxType!: TSandbox; // Phantom type for TypeScript inference

  constructor(config: TConfig, providerConfig: ProviderConfig<TSandbox, TConfig, TTemplate, TSnapshot>) {
    this.name = providerConfig.name;
    this.sandbox = new GeneratedSandboxManager(
      config,
      providerConfig.name,
      providerConfig.methods.sandbox,
      this
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
  // Auto-inject default filesystem methods if none provided
  if (!providerConfig.methods.sandbox.filesystem) {
    providerConfig.methods.sandbox.filesystem = defaultFilesystemMethods;
  }

  return (config: TConfig) => {
    return new GeneratedProvider(config, providerConfig);
  };
}