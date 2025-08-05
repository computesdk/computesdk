/**
 * ComputeSDK Core
 * 
 * A unified abstraction layer for executing code in secure,
 * isolated sandboxed environments across multiple cloud providers.
 */

// Export all types
export * from './types';

// Export all errors
export * from './errors';

// Export configuration utilities
export * from './config';

// Export utilities
export { executeSandbox, runCode, runCommand, retry } from './utils';

// Export registry
export { createComputeRegistry } from './registry';

// Export base provider for extension
export { BaseProvider, BaseFileSystem, BaseTerminal } from './providers/base';

// Export main SDK class
export { ComputeSDK } from './sdk';

// Export test utilities (for provider testing)
export { runProviderTestSuite } from './__tests__/shared/provider-test-suite';

// Default export
import { ComputeSDK } from './sdk';
export default ComputeSDK;
