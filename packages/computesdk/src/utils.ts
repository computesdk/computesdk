/**
 * Utility functions for ComputeSDK
 */

import type { ExecuteSandboxParams, ExecutionResult, ComputeSandbox } from './types';

/**
 * Execute code in a sandbox
 */
export async function executeSandbox(params: ExecuteSandboxParams): Promise<ExecutionResult> {
  return await params.sandbox.execute(params.code, params.runtime);
}

/**
 * Retry function with exponential backoff
 */
export async function retry<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  baseDelay: number = 1000
): Promise<T> {
  let lastError: Error;
  
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      
      if (i === maxRetries - 1) {
        throw lastError;
      }
      
      // Exponential backoff
      const delay = baseDelay * Math.pow(2, i);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  
  throw lastError!;
}