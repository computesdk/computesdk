/**
 * Provider Factory - Creates providers from method definitions
 * 
 * Eliminates boilerplate by auto-generating Provider/Sandbox classes
 * from simple method definitions with automatic feature detection.
 */

import type {
  Provider,
  ProviderSandboxManager,
  Sandbox,
  SandboxFileSystem,
  SandboxTerminal,
  SandboxInfo,
  ExecutionResult,
  Runtime,
  CreateSandboxOptions,
  FileEntry,
  TerminalSession,
  TerminalCreateOptions,
  SandboxManagerMethods,
} from './types/index.js';

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
  runCode: (sandbox: TSandbox, code: string, runtime?: Runtime) => Promise<ExecutionResult>;
  runCommand: (sandbox: TSandbox, command: string, args?: string[]) => Promise<ExecutionResult>;
  getInfo: (sandbox: TSandbox) => Promise<SandboxInfo>;
  
  // Optional filesystem methods
  filesystem?: {
    readFile: (sandbox: TSandbox, path: string) => Promise<string>;
    writeFile: (sandbox: TSandbox, path: string, content: string) => Promise<void>;
    mkdir: (sandbox: TSandbox, path: string) => Promise<void>;
    readdir: (sandbox: TSandbox, path: string) => Promise<FileEntry[]>;
    exists: (sandbox: TSandbox, path: string) => Promise<boolean>;
    remove: (sandbox: TSandbox, path: string) => Promise<void>;
  };
  
  // Optional terminal methods
  terminal?: {
    create: (sandbox: TSandbox, options?: TerminalCreateOptions) => Promise<TerminalSession>;
    list: (sandbox: TSandbox) => Promise<TerminalSession[]>;
  };
}

/**
 * Provider configuration for createProvider()
 */
export interface ProviderConfig<TSandbox = any, TConfig = any> {
  name: string;
  methods: {
    sandbox: SandboxMethods<TSandbox, TConfig>;
  };
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
 * Auto-generated terminal implementation that throws "not supported" errors
 */
class UnsupportedTerminal implements SandboxTerminal {
  private readonly providerName: string;

  constructor(providerName: string) {
    this.providerName = providerName;
  }

  async create(_options?: TerminalCreateOptions): Promise<TerminalSession> {
    throw new Error(`Interactive terminal sessions are not supported by ${this.providerName}'s sandbox environment. ${this.providerName} sandboxes only support individual command execution.`);
  }

  async list(): Promise<TerminalSession[]> {
    throw new Error(`Interactive terminal sessions are not supported by ${this.providerName}'s sandbox environment. ${this.providerName} sandboxes only support individual command execution.`);
  }
}

/**
 * Auto-generated filesystem implementation that wraps provider methods
 */
class SupportedFileSystem<TSandbox> implements SandboxFileSystem {
  constructor(
    private sandbox: TSandbox,
    private methods: NonNullable<SandboxMethods<TSandbox>['filesystem']>
  ) {}

  async readFile(path: string): Promise<string> {
    return this.methods.readFile(this.sandbox, path);
  }

  async writeFile(path: string, content: string): Promise<void> {
    return this.methods.writeFile(this.sandbox, path, content);
  }

  async mkdir(path: string): Promise<void> {
    return this.methods.mkdir(this.sandbox, path);
  }

  async readdir(path: string): Promise<FileEntry[]> {
    return this.methods.readdir(this.sandbox, path);
  }

  async exists(path: string): Promise<boolean> {
    return this.methods.exists(this.sandbox, path);
  }

  async remove(path: string): Promise<void> {
    return this.methods.remove(this.sandbox, path);
  }
}

/**
 * Auto-generated terminal implementation that wraps provider methods
 */
class SupportedTerminal<TSandbox> implements SandboxTerminal {
  constructor(
    private sandbox: TSandbox,
    private methods: NonNullable<SandboxMethods<TSandbox>['terminal']>
  ) {}

  async create(options?: TerminalCreateOptions): Promise<TerminalSession> {
    return this.methods.create(this.sandbox, options);
  }

  async list(): Promise<TerminalSession[]> {
    return this.methods.list(this.sandbox);
  }
}

/**
 * Generated sandbox class - implements the Sandbox interface
 */
class GeneratedSandbox<TSandbox = any> implements Sandbox {
  readonly sandboxId: string;
  readonly provider: string;
  readonly filesystem: SandboxFileSystem;
  readonly terminal: SandboxTerminal;

  constructor(
    private sandbox: TSandbox,
    sandboxId: string,
    providerName: string,
    private methods: SandboxMethods<TSandbox>,
    private config: any,
    private destroyMethod: (config: any, sandboxId: string) => Promise<void>
  ) {
    this.sandboxId = sandboxId;
    this.provider = providerName;

    // Auto-detect filesystem support
    if (methods.filesystem) {
      this.filesystem = new SupportedFileSystem(sandbox, methods.filesystem);
    } else {
      this.filesystem = new UnsupportedFileSystem(providerName);
    }

    // Auto-detect terminal support
    if (methods.terminal) {
      this.terminal = new SupportedTerminal(sandbox, methods.terminal);
    } else {
      this.terminal = new UnsupportedTerminal(providerName);
    }
  }

  async runCode(code: string, runtime?: Runtime): Promise<ExecutionResult> {
    return await this.methods.runCode(this.sandbox, code, runtime);
  }

  async runCommand(command: string, args?: string[]): Promise<ExecutionResult> {
    return await this.methods.runCommand(this.sandbox, command, args);
  }

  async getInfo(): Promise<SandboxInfo> {
    return await this.methods.getInfo(this.sandbox);
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
class GeneratedSandboxManager<TSandbox, TConfig> implements ProviderSandboxManager {
  private activeSandboxes: Map<string, GeneratedSandbox<TSandbox>> = new Map();

  constructor(
    private config: TConfig,
    private providerName: string,
    private methods: SandboxMethods<TSandbox, TConfig>
  ) {}

  async create(options?: CreateSandboxOptions): Promise<Sandbox> {
    const result = await this.methods.create(this.config, options);
    const sandbox = new GeneratedSandbox(
      result.sandbox,
      result.sandboxId,
      this.providerName,
      this.methods,
      this.config,
      this.methods.destroy
    );
    
    this.activeSandboxes.set(result.sandboxId, sandbox);
    return sandbox;
  }

  async getById(sandboxId: string): Promise<Sandbox | null> {
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

    const sandbox = new GeneratedSandbox(
      result.sandbox,
      result.sandboxId,
      this.providerName,
      this.methods,
      this.config,
      this.methods.destroy
    );
    
    this.activeSandboxes.set(result.sandboxId, sandbox);
    return sandbox;
  }

  async list(): Promise<Sandbox[]> {
    const results = await this.methods.list(this.config);
    const sandboxes: Sandbox[] = [];

    for (const result of results) {
      let sandbox = this.activeSandboxes.get(result.sandboxId);
      if (!sandbox) {
        sandbox = new GeneratedSandbox(
          result.sandbox,
          result.sandboxId,
          this.providerName,
          this.methods,
          this.config,
          this.methods.destroy
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
 * Auto-generated Provider implementation
 */
class GeneratedProvider<TSandbox, TConfig> implements Provider {
  readonly name: string;
  readonly sandbox: ProviderSandboxManager;

  constructor(config: TConfig, providerConfig: ProviderConfig<TSandbox, TConfig>) {
    this.name = providerConfig.name;
    this.sandbox = new GeneratedSandboxManager(
      config,
      providerConfig.name,
      providerConfig.methods.sandbox
    );
  }
}

/**
 * Create a provider from method definitions
 * 
 * Auto-generates all boilerplate classes and provides feature detection
 * based on which methods are implemented.
 */
export function createProvider<TSandbox, TConfig>(
  providerConfig: ProviderConfig<TSandbox, TConfig>
): (config: TConfig) => Provider {
  return (config: TConfig) => {
    return new GeneratedProvider(config, providerConfig);
  };
}