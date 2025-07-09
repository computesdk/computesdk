/**
 * ComputeSDK Base Provider
 * 
 * This file contains the base provider implementation that all
 * specific provider implementations extend.
 */

import { v4 as uuidv4 } from 'uuid';
import {
  ComputeSpecification,
  ComputeSandbox,
  Runtime,
  ExecutionResult,
  SandboxInfo
} from '../types';
import { ProviderError, TimeoutError } from '../errors';

/**
 * Base implementation of the ComputeSandbox interface
 * 
 * Provides common functionality and wraps provider-specific implementations.
 */
export abstract class BaseProvider implements ComputeSandbox, ComputeSpecification {
  /** Specification version */
  public readonly specificationVersion = 'v1';

  /** Provider identifier */
  public readonly provider: string;

  /** Sandbox identifier */
  public readonly sandboxId: string;

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
    this.sandboxId = uuidv4();
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
}
