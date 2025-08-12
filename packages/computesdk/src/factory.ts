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
  runCode: (sandbox: TSandbox, code: string, runtime?: Runtime, config?: TConfig) => Promise<ExecutionResult>;
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
    create: (sandbox: TSandbox, options?: TerminalCreateOptions) => Promise<{ terminal: any; terminalId: string }>;
    getById: (sandbox: TSandbox, terminalId: string) => Promise<{ terminal: any; terminalId: string } | null>;
    list: (sandbox: TSandbox) => Promise<Array<{ terminal: any; terminalId: string }>>;
    destroy: (sandbox: TSandbox, terminalId: string) => Promise<void>;
    // Terminal instance methods
    write: (sandbox: TSandbox, terminal: any, data: Uint8Array | string) => Promise<void>;
    resize: (sandbox: TSandbox, terminal: any, cols: number, rows: number) => Promise<void>;
    kill: (sandbox: TSandbox, terminal: any) => Promise<void>;
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
    throw new Error(`Terminal operations are not supported by ${this.providerName}'s sandbox environment. ${this.providerName} sandboxes are designed for code execution only.`);
  }

  async getById(_terminalId: string): Promise<TerminalSession | null> {
    throw new Error(`Terminal operations are not supported by ${this.providerName}'s sandbox environment. ${this.providerName} sandboxes are designed for code execution only.`);
  }

  async list(): Promise<TerminalSession[]> {
    throw new Error(`Terminal operations are not supported by ${this.providerName}'s sandbox environment. ${this.providerName} sandboxes are designed for code execution only.`);
  }

  async destroy(_terminalId: string): Promise<void> {
    throw new Error(`Terminal operations are not supported by ${this.providerName}'s sandbox environment. ${this.providerName} sandboxes are designed for code execution only.`);
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
 * Generated terminal session class - implements the TerminalSession interface
 */
class GeneratedTerminalSession<TSandbox = any> implements TerminalSession {
  readonly pid: number;
  readonly command: string;
  readonly status: 'running' | 'exited';
  readonly cols: number;
  readonly rows: number;
  onData?: (data: Uint8Array) => void;
  onExit?: (exitCode: number) => void;

  constructor(
    private terminal: any,
    private sandbox: TSandbox,
    private methods: NonNullable<SandboxMethods<TSandbox>['terminal']>,
    terminalId: string,
    command: string,
    cols: number = 80,
    rows: number = 24
  ) {
    this.pid = parseInt(terminalId);
    this.command = command;
    this.status = 'running';
    this.cols = cols;
    this.rows = rows;
  }

  async write(data: Uint8Array | string): Promise<void> {
    return this.methods.write(this.sandbox, this.terminal, data);
  }

  async resize(cols: number, rows: number): Promise<void> {
    return this.methods.resize(this.sandbox, this.terminal, cols, rows);
  }

  async kill(): Promise<void> {
    return this.methods.kill(this.sandbox, this.terminal);
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
    // Create a GeneratedTerminalSession first so we can set up callback forwarding
    let terminalSession: GeneratedTerminalSession<TSandbox>;
    
    // Create options with callback forwarding to the GeneratedTerminalSession
    const createOptions: TerminalCreateOptions = {
      ...options,
      onData: (data: Uint8Array) => {
        // Forward to the GeneratedTerminalSession's onData if set
        if (terminalSession?.onData) {
          terminalSession.onData(data);
        }
      },
      onExit: (exitCode: number) => {
        // Forward to the GeneratedTerminalSession's onExit if set
        if (terminalSession?.onExit) {
          terminalSession.onExit(exitCode);
        }
      }
    };

    const result = await this.methods.create(this.sandbox, createOptions);
    
    // Now create the GeneratedTerminalSession
    terminalSession = new GeneratedTerminalSession(
      result.terminal,
      this.sandbox,
      this.methods,
      result.terminalId,
      options?.command || 'bash',
      options?.cols || 80,
      options?.rows || 24
    );

    // Set the original callbacks on the terminal session
    terminalSession.onData = options?.onData;
    terminalSession.onExit = options?.onExit;

    return terminalSession;
  }

  async getById(terminalId: string): Promise<TerminalSession | null> {
    const result = await this.methods.getById(this.sandbox, terminalId);
    if (!result) return null;
    
    return new GeneratedTerminalSession(
      result.terminal,
      this.sandbox,
      this.methods,
      result.terminalId,
      'bash', // Default command for existing terminals
      80, // Default cols
      24  // Default rows
    );
  }

  async list(): Promise<TerminalSession[]> {
    const results = await this.methods.list(this.sandbox);
    return results.map(result => new GeneratedTerminalSession(
      result.terminal,
      this.sandbox,
      this.methods,
      result.terminalId,
      'bash', // Default command
      80, // Default cols
      24  // Default rows
    ));
  }

  async destroy(terminalId: string): Promise<void> {
    return this.methods.destroy(this.sandbox, terminalId);
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
    return await this.methods.runCode(this.sandbox, code, runtime, this.config);
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