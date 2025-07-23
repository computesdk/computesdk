/**
 * Utility functions for ComputeSDK
 */

import type { ExecuteSandboxParams, ExecutionResult, ComputeSandbox, Runtime } from './types';

/**
 * Execute code in a sandbox
 */
export async function executeSandbox(params: ExecuteSandboxParams): Promise<ExecutionResult> {
  return await params.sandbox.execute(params.code, params.runtime);
}

/**
 * Parameters for the runCode function
 */
export interface RunCodeParams {
  /** Sandbox to execute in */
  sandbox: ComputeSandbox;
  /** Code to execute */
  code: string;
  /** Runtime to use */
  runtime?: Runtime;
}

/**
 * Execute code in a runtime environment
 */
export async function runCode(params: RunCodeParams): Promise<ExecutionResult> {
  return await params.sandbox.runCode(params.code, params.runtime);
}

/**
 * Parameters for the runCommand function
 */
export interface RunCommandParams {
  /** Sandbox to execute in */
  sandbox: ComputeSandbox;
  /** Command to execute */
  command: string;
  /** Command arguments */
  args?: string[];
}

/**
 * Execute shell commands
 */
export async function runCommand(params: RunCommandParams): Promise<ExecutionResult> {
  return await params.sandbox.runCommand(params.command, params.args);
}

/**
 * Options for retry function
 */
export interface RetryOptions {
  /** Maximum number of attempts (default: 3) */
  maxAttempts?: number;
  /** Base delay in milliseconds (default: 1000) */
  delay?: number;
  /** Backoff multiplier (default: 2) */
  backoff?: number;
  /** Callback called on each retry attempt */
  onRetry?: (error: Error, attempt: number) => void;
}

/**
 * Retry function with exponential backoff
 */
export async function retry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const {
    maxAttempts = 3,
    delay = 1000,
    backoff = 2,
    onRetry
  } = options;
  
  let lastError: Error;
  
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      
      if (attempt === maxAttempts - 1) {
        throw lastError;
      }
      
      // Call onRetry callback if provided
      if (onRetry) {
        onRetry(lastError, attempt + 1);
      }
      
      // Calculate delay with exponential backoff
      const currentDelay = delay * Math.pow(backoff, attempt);
      await new Promise(resolve => setTimeout(resolve, currentDelay));
    }
  }
  
  throw lastError!;
}