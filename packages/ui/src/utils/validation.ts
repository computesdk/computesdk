import type { Runtime, ValidationResult, ExecutionOptions } from '../types/index.js';

export function validateCode(code: string): ValidationResult {
  const errors: string[] = [];

  if (!code || typeof code !== 'string') {
    errors.push('Code is required and must be a string');
  }

  if (code.trim().length === 0) {
    errors.push('Code cannot be empty');
  }

  if (code.length > 50000) {
    errors.push('Code is too long (maximum 50,000 characters)');
  }

  return {
    isValid: errors.length === 0,
    errors
  };
}

export function validateRuntime(runtime: string): ValidationResult {
  const errors: string[] = [];
  const validRuntimes: Runtime[] = ['python', 'javascript'];

  if (!runtime || typeof runtime !== 'string') {
    errors.push('Runtime is required and must be a string');
  } else if (!validRuntimes.includes(runtime as Runtime)) {
    errors.push(`Runtime must be one of: ${validRuntimes.join(', ')}`);
  }

  return {
    isValid: errors.length === 0,
    errors
  };
}

export function validateApiEndpoint(endpoint: string): ValidationResult {
  const errors: string[] = [];

  if (!endpoint || typeof endpoint !== 'string') {
    errors.push('API endpoint is required and must be a string');
  }

  if (endpoint && !endpoint.startsWith('/')) {
    errors.push('API endpoint must start with "/"');
  }

  return {
    isValid: errors.length === 0,
    errors
  };
}

export function validateExecutionOptions(options: ExecutionOptions): ValidationResult {
  const errors: string[] = [];
  
  if (options.timeout !== undefined) {
    if (options.timeout < 0) {
      errors.push('Timeout must be positive');
    } else if (options.timeout > 600000) {
      errors.push('Timeout cannot exceed 600000ms (10 minutes)');
    }
  }
  
  if (options.retries !== undefined) {
    if (options.retries < 0) {
      errors.push('Retries must be non-negative');
    } else if (options.retries > 5) {
      errors.push('Retries cannot exceed 5');
    }
  }
  
  return {
    isValid: errors.length === 0,
    errors
  };
}