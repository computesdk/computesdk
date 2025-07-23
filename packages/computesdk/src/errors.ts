/**
 * ComputeSDK Error Handling
 * 
 * This file contains standardized error classes for the ComputeSDK.
 */

/**
 * Base error class for all ComputeSDK errors
 */
export abstract class ComputeError extends Error {
  /** Error code identifier */
  abstract readonly code: string;

  /** Whether the operation can be retried */
  abstract readonly isRetryable: boolean;

  /** Provider where the error occurred */
  readonly provider: string;

  /** Sandbox ID where the error occurred */
  readonly sandboxId?: string;

  /**
   * Create a new ComputeError
   * 
   * @param message Error message
   * @param provider Provider identifier
   * @param sandboxId Optional sandbox identifier
   */
  constructor(message: string, provider: string, sandboxId?: string) {
    super(message);
    this.name = this.constructor.name;
    this.provider = provider;
    this.sandboxId = sandboxId;

    // Ensure proper prototype chain for instanceof checks
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Error thrown when code execution fails
 */
export class ExecutionError extends ComputeError {
  /** Error code */
  readonly code = 'EXECUTION_ERROR';

  /** Execution errors are generally not retryable */
  readonly isRetryable = false;

  /** Exit code from the failed execution */
  readonly exitCode: number;

  /**
   * Create a new ExecutionError
   * 
   * @param message Error message
   * @param provider Provider identifier
   * @param exitCode Exit code from the execution
   * @param sandboxId Optional sandbox identifier
   */
  constructor(message: string, provider: string, exitCode: number, sandboxId?: string) {
    super(message, provider, sandboxId);
    this.exitCode = exitCode;
  }
}

/**
 * Error thrown when code execution times out
 */
export class TimeoutError extends ComputeError {
  /** Error code */
  readonly code = 'TIMEOUT_ERROR';

  /** Timeout errors may be retryable with a longer timeout */
  readonly isRetryable = true;

  /** Timeout duration in milliseconds */
  readonly timeoutMs: number;

  /**
   * Create a new TimeoutError
   * 
   * @param message Error message
   * @param provider Provider identifier
   * @param timeoutMs Timeout duration in milliseconds
   * @param sandboxId Optional sandbox identifier
   */
  constructor(message: string, provider: string, timeoutMs: number, sandboxId?: string) {
    super(message, provider, sandboxId);
    this.timeoutMs = timeoutMs;
  }
}

/**
 * Error thrown when provider-specific operations fail
 */
export class ProviderError extends ComputeError {
  /** Error code */
  readonly code = 'PROVIDER_ERROR';

  /** Provider errors may be retryable */
  readonly isRetryable = true;

  /** Original error from the provider */
  readonly originalError?: Error;

  /**
   * Create a new ProviderError
   * 
   * @param message Error message
   * @param provider Provider identifier
   * @param originalError Optional original error from the provider
   * @param sandboxId Optional sandbox identifier
   */
  constructor(message: string, provider: string, originalError?: Error, sandboxId?: string) {
    super(message, provider, sandboxId);
    this.originalError = originalError;
  }
}

/**
 * Error thrown when configuration is invalid
 */
export class ConfigurationError extends ComputeError {
  /** Error code */
  readonly code = 'CONFIGURATION_ERROR';

  /** Configuration errors are not retryable without changes */
  readonly isRetryable = false;

  /**
   * Create a new ConfigurationError
   * 
   * @param message Error message
   * @param provider Provider identifier
   * @param sandboxId Optional sandbox identifier
   */
  constructor(message: string, provider: string, sandboxId?: string) {
    super(message, provider, sandboxId);
  }
}

/**
 * Error thrown when authentication fails
 */
export class AuthenticationError extends ComputeError {
  /** Error code */
  readonly code = 'AUTHENTICATION_ERROR';

  /** Authentication errors are not retryable without new credentials */
  readonly isRetryable = false;

  /**
   * Create a new AuthenticationError
   * 
   * @param message Error message
   * @param provider Provider identifier
   * @param sandboxId Optional sandbox identifier
   */
  constructor(message: string, provider: string, sandboxId?: string) {
    super(message, provider, sandboxId);
  }
}

/**
 * Error thrown when the provider is not available
 */
export class ProviderUnavailableError extends ComputeError {
  /** Error code */
  readonly code = 'PROVIDER_UNAVAILABLE';

  /** Provider unavailability may be temporary */
  readonly isRetryable = true;

  /**
   * Create a new ProviderUnavailableError
   * 
   * @param message Error message
   * @param provider Provider identifier
   * @param sandboxId Optional sandbox identifier
   */
  constructor(message: string, provider: string, sandboxId?: string) {
    super(message, provider, sandboxId);
  }
}
