import type { Runtime, ValidationResult, ComputeRequest, ComputeConfig } from '../types/index.js';

/**
 * Validate code input
 */
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

/**
 * Validate runtime selection
 */
export function validateRuntime(runtime: string): ValidationResult {
  const errors: string[] = [];
  const validRuntimes: Runtime[] = ['python', 'node'];

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

/**
 * Validate API endpoint
 */
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

/**
 * Validate compute configuration
 */
export function validateComputeConfig(config: ComputeConfig): ValidationResult {
  const errors: string[] = [];
  
  // Validate API endpoint
  const endpointValidation = validateApiEndpoint(config.apiEndpoint);
  if (!endpointValidation.isValid) {
    errors.push(...endpointValidation.errors);
  }
  
  // Validate timeout
  if (config.timeout !== undefined) {
    if (config.timeout < 0) {
      errors.push('Timeout must be positive');
    } else if (config.timeout > 600000) {
      errors.push('Timeout cannot exceed 600000ms (10 minutes)');
    }
  }
  
  // Validate retries
  if (config.retries !== undefined) {
    if (config.retries < 0) {
      errors.push('Retries must be non-negative');
    } else if (config.retries > 5) {
      errors.push('Retries cannot exceed 5');
    }
  }
  
  // Validate default runtime
  if (config.defaultRuntime) {
    const runtimeValidation = validateRuntime(config.defaultRuntime);
    if (!runtimeValidation.isValid) {
      errors.push(...runtimeValidation.errors);
    }
  }
  
  return {
    isValid: errors.length === 0,
    errors
  };
}

/**
 * Validate compute request
 */
export function validateComputeRequest(request: ComputeRequest): ValidationResult {
  const errors: string[] = [];
  
  // Validate action
  if (!request.action) {
    errors.push('Action is required');
  }
  
  // Validate code for runCode action
  if (request.action === 'compute.sandbox.runCode') {
    if (!request.code) {
      errors.push('Code is required for runCode action');
    } else {
      const codeValidation = validateCode(request.code);
      if (!codeValidation.isValid) {
        errors.push(...codeValidation.errors);
      }
    }
    
    if (request.runtime) {
      const runtimeValidation = validateRuntime(request.runtime);
      if (!runtimeValidation.isValid) {
        errors.push(...runtimeValidation.errors);
      }
    }
  }
  
  // Validate command for runCommand action
  if (request.action === 'compute.sandbox.runCommand') {
    if (!request.command) {
      errors.push('Command is required for runCommand action');
    }
  }
  
  // Validate path for filesystem operations
  const filesystemActions = [
    'compute.sandbox.filesystem.readFile',
    'compute.sandbox.filesystem.writeFile',
    'compute.sandbox.filesystem.mkdir',
    'compute.sandbox.filesystem.readdir',
    'compute.sandbox.filesystem.exists',
    'compute.sandbox.filesystem.remove'
  ];
  
  if (filesystemActions.includes(request.action)) {
    if (!request.path) {
      errors.push('Path is required for filesystem operations');
    }
    
    if (request.action === 'compute.sandbox.filesystem.writeFile' && request.content === undefined) {
      errors.push('Content is required for writeFile action');
    }
  }
  
  return {
    isValid: errors.length === 0,
    errors
  };
}