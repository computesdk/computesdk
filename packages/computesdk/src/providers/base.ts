/**
 * ComputeSDK Base Provider
 * 
 * This file contains the base provider implementation that all
 * specific provider implementations extend.
 */


import {
  BaseComputeSpecification,
  BaseComputeSandbox,
  Runtime,
  ExecutionResult,
  SandboxInfo,
  SandboxFileSystem,
  SandboxTerminal
} from '../types';
import { ProviderError, TimeoutError } from '../errors';

/**
 * Base implementation of the ComputeSandbox interface
 * 
 * Provides common functionality and wraps provider-specific implementations.
 */
export abstract class BaseProvider implements BaseComputeSandbox, BaseComputeSpecification {
  /** Specification version */
  public readonly specificationVersion = 'v1';

  /** Provider identifier */
  public readonly provider: string;

  /** Sandbox identifier - must be implemented by each provider */
  public abstract readonly sandboxId: string;

  /** Execution timeout in milliseconds */
  protected readonly timeout: number;

  /**
   * Create a new base provider
   * 
   * @param provider Provider identifier
   * @param timeout Execution timeout in milliseconds
   */
  constructor(provider: string, timeout: number) {
    this.provider = provider;
    this.timeout = timeout;
  }

  /**
   * Execute code in the sandbox
   * 
   * @param code Code to execute
   * @param runtime Optional runtime to use
   * @returns Execution result
   */
  public async execute(code: string, runtime?: Runtime): Promise<ExecutionResult> {
    const startTime = Date.now();

    try {
      // Create a timeout promise that rejects after the timeout
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => {
          reject(new TimeoutError(
            `Execution timed out after ${this.timeout}ms`,
            this.provider,
            this.timeout,
            this.sandboxId
          ));
        }, this.timeout);
      });

      // Execute the code with a timeout
      const result = await Promise.race([
        this.doExecute(code, runtime),
        timeoutPromise
      ]);

      // Calculate execution time
      const executionTime = Date.now() - startTime;

      return {
        ...result,
        executionTime,
        sandboxId: this.sandboxId,
        provider: this.provider
      };
    } catch (error) {
      // If the error is already a ComputeError, rethrow it
      if (error instanceof Error && error.name.includes('Error') && 'code' in error) {
        throw error;
      }

      // Otherwise, wrap it in a ProviderError
      throw new ProviderError(
        `Execution failed: ${error instanceof Error ? error.message : String(error)}`,
        this.provider,
        error instanceof Error ? error : undefined,
        this.sandboxId
      );
    }
  }

  /**
   * Kill the sandbox
   * 
   * @returns Promise that resolves when the sandbox is killed
   */
  public async kill(): Promise<void> {
    try {
      await this.doKill();
    } catch (error) {
      throw new ProviderError(
        `Failed to kill sandbox: ${error instanceof Error ? error.message : String(error)}`,
        this.provider,
        error instanceof Error ? error : undefined,
        this.sandboxId
      );
    }
  }

  /**
   * Get information about the sandbox
   * 
   * @returns Sandbox information
   */
  public async getInfo(): Promise<SandboxInfo> {
    try {
      return await this.doGetInfo();
    } catch (error) {
      throw new ProviderError(
        `Failed to get sandbox info: ${error instanceof Error ? error.message : String(error)}`,
        this.provider,
        error instanceof Error ? error : undefined,
        this.sandboxId
      );
    }
  }

  /**
   * Execute code in a runtime environment
   * 
   * @param code Code to execute
   * @param runtime Optional runtime to use
   * @returns Execution result
   */
  public async runCode(code: string, runtime?: Runtime): Promise<ExecutionResult> {
    const startTime = Date.now();

    try {
      // Create a timeout promise that rejects after the timeout
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => {
          reject(new TimeoutError(
            `Code execution timed out after ${this.timeout}ms`,
            this.provider,
            this.timeout,
            this.sandboxId
          ));
        }, this.timeout);
      });

      // Execute the code with a timeout
      const result = await Promise.race([
        this.doRunCode ? this.doRunCode(code, runtime) : this.doExecute(code, runtime),
        timeoutPromise
      ]);

      // Calculate execution time
      const executionTime = Date.now() - startTime;

      return {
        ...result,
        executionTime,
        sandboxId: this.sandboxId,
        provider: this.provider
      };
    } catch (error) {
      // If the error is already a ComputeError, rethrow it
      if (error instanceof Error && error.name.includes('Error') && 'code' in error) {
        throw error;
      }

      // Otherwise, wrap it in a ProviderError
      throw new ProviderError(
        `Code execution failed: ${error instanceof Error ? error.message : String(error)}`,
        this.provider,
        error instanceof Error ? error : undefined,
        this.sandboxId
      );
    }
  }

  /**
   * Execute shell commands
   * 
   * @param command Command to execute
   * @param args Command arguments
   * @returns Execution result
   */
  public async runCommand(command: string, args: string[] = []): Promise<ExecutionResult> {
    const startTime = Date.now();

    try {
      // Create a timeout promise that rejects after the timeout
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => {
          reject(new TimeoutError(
            `Command execution timed out after ${this.timeout}ms`,
            this.provider,
            this.timeout,
            this.sandboxId
          ));
        }, this.timeout);
      });

      // Execute the command with a timeout
      const result = await Promise.race([
        this.doRunCommand ? this.doRunCommand(command, args) : this.doExecute(`${command} ${args.join(' ')}`, 'node'),
        timeoutPromise
      ]);

      // Calculate execution time
      const executionTime = Date.now() - startTime;

      return {
        ...result,
        executionTime,
        sandboxId: this.sandboxId,
        provider: this.provider
      };
    } catch (error) {
      // If the error is already a ComputeError, rethrow it
      if (error instanceof Error && error.name.includes('Error') && 'code' in error) {
        throw error;
      }

      // Otherwise, wrap it in a ProviderError
      throw new ProviderError(
        `Command execution failed: ${error instanceof Error ? error.message : String(error)}`,
        this.provider,
        error instanceof Error ? error : undefined,
        this.sandboxId
      );
    }
  }

  /**
   * Provider-specific implementation of code execution
   * 
   * @param code Code to execute
   * @param runtime Optional runtime to use
   * @returns Execution result
   */
  public abstract doExecute(code: string, runtime?: Runtime): Promise<ExecutionResult>;

  /**
   * Provider-specific implementation of sandbox termination
   * 
   * @returns Promise that resolves when the sandbox is killed
   */
  public abstract doKill(): Promise<void>;

  /**
   * Provider-specific implementation of retrieving sandbox information
   * 
   * @returns Sandbox information
   */
  public abstract doGetInfo(): Promise<SandboxInfo>;

  /**
   * Provider-specific implementation of code execution (optional)
   * 
   * @param code Code to execute
   * @param runtime Optional runtime to use
   * @returns Execution result
   */
  public doRunCode?(code: string, runtime?: Runtime): Promise<ExecutionResult>;

  /**
   * Provider-specific implementation of command execution (optional)
   * 
   * @param command Command to execute
   * @param args Command arguments
   * @returns Execution result
   */
  public doRunCommand?(command: string, args: string[]): Promise<ExecutionResult>;
}

/**
 * Helper class for implementing FileSystem with error handling
 */
export abstract class BaseFileSystem implements SandboxFileSystem {
  constructor(
    protected provider: string,
    protected sandboxId: string
  ) {}

  async readFile(path: string): Promise<string> {
    try {
      return await this.doReadFile(path);
    } catch (error) {
      throw new ProviderError(
        `Failed to read file: ${error instanceof Error ? error.message : String(error)}`,
        this.provider,
        error instanceof Error ? error : undefined,
        this.sandboxId
      );
    }
  }

  async writeFile(path: string, content: string): Promise<void> {
    try {
      await this.doWriteFile(path, content);
    } catch (error) {
      throw new ProviderError(
        `Failed to write file: ${error instanceof Error ? error.message : String(error)}`,
        this.provider,
        error instanceof Error ? error : undefined,
        this.sandboxId
      );
    }
  }

  async mkdir(path: string): Promise<void> {
    try {
      await this.doMkdir(path);
    } catch (error) {
      throw new ProviderError(
        `Failed to create directory: ${error instanceof Error ? error.message : String(error)}`,
        this.provider,
        error instanceof Error ? error : undefined,
        this.sandboxId
      );
    }
  }

  async readdir(path: string): Promise<import('../types').FileEntry[]> {
    try {
      return await this.doReaddir(path);
    } catch (error) {
      throw new ProviderError(
        `Failed to read directory: ${error instanceof Error ? error.message : String(error)}`,
        this.provider,
        error instanceof Error ? error : undefined,
        this.sandboxId
      );
    }
  }

  async exists(path: string): Promise<boolean> {
    try {
      return await this.doExists(path);
    } catch (error) {
      return false;
    }
  }

  async remove(path: string): Promise<void> {
    try {
      await this.doRemove(path);
    } catch (error) {
      throw new ProviderError(
        `Failed to remove: ${error instanceof Error ? error.message : String(error)}`,
        this.provider,
        error instanceof Error ? error : undefined,
        this.sandboxId
      );
    }
  }

  protected abstract doReadFile(path: string): Promise<string>;
  protected abstract doWriteFile(path: string, content: string): Promise<void>;
  protected abstract doMkdir(path: string): Promise<void>;
  protected abstract doReaddir(path: string): Promise<import('../types').FileEntry[]>;
  protected abstract doExists(path: string): Promise<boolean>;
  protected abstract doRemove(path: string): Promise<void>;
}

/**
 * Helper class for implementing Terminal with error handling
 */
export abstract class BaseTerminal implements SandboxTerminal {
  constructor(
    protected provider: string,
    protected sandboxId: string
  ) {}

  async create(options?: import('../types').TerminalCreateOptions): Promise<import('../types').InteractiveTerminalSession> {
    try {
      return await this.doCreate(options);
    } catch (error) {
      throw new ProviderError(
        `Failed to create terminal: ${error instanceof Error ? error.message : String(error)}`,
        this.provider,
        error instanceof Error ? error : undefined,
        this.sandboxId
      );
    }
  }

  async list(): Promise<import('../types').InteractiveTerminalSession[]> {
    try {
      return await this.doList();
    } catch (error) {
      throw new ProviderError(
        `Failed to list terminals: ${error instanceof Error ? error.message : String(error)}`,
        this.provider,
        error instanceof Error ? error : undefined,
        this.sandboxId
      );
    }
  }

  protected abstract doCreate(options?: import('../types').TerminalCreateOptions): Promise<import('../types').InteractiveTerminalSession>;
  protected abstract doList(): Promise<import('../types').InteractiveTerminalSession[]>;
}
