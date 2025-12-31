/**
 * Railway Provider - Compute Factory
 * 
 * Provides a first-class Railway provider experience by routing all operations
 * through the ComputeSDK gateway. The gateway handles infrastructure provisioning
 * via @computesdk/gateway and installs the daemon for full sandbox capabilities.
 */

import { defineCompute, type ComputeConfig } from '@computesdk/provider';

/**
 * Railway provider configuration
 */
export interface RailwayConfig extends ComputeConfig {
  /** Railway API key - if not provided, will fallback to RAILWAY_API_KEY environment variable */
  apiKey?: string;
  /** Railway Project ID - if not provided, will fallback to RAILWAY_PROJECT_ID environment variable */
  projectId?: string;
  /** Railway Environment ID - if not provided, will fallback to RAILWAY_ENVIRONMENT_ID environment variable */
  environmentId?: string;
}

/**
 * Railway compute factory - creates configured compute instances
 * 
 * Railway is an infrastructure provider that becomes a full sandbox provider
 * via the ComputeSDK gateway. The gateway provisions Railway services with the
 * daemon pre-installed, enabling full sandbox capabilities.
 * 
 * @example
 * ```typescript
 * import { railway } from '@computesdk/railway';
 * 
 * const compute = railway({
 *   apiKey: 'railway_xxx',
 *   projectId: 'project_xxx',
 *   environmentId: 'env_xxx'
 * });
 * 
 * // Full compute API available (routes through gateway)
 * const sandbox = await compute.sandbox.create();
 * 
 * // Execute code
 * const result = await sandbox.runCode('console.log("Hello from Railway!")');
 * console.log(result.stdout);
 * 
 * // Filesystem operations
 * await sandbox.filesystem.writeFile('/tmp/test.txt', 'Hello!');
 * const content = await sandbox.filesystem.readFile('/tmp/test.txt');
 * 
 * // Cleanup
 * await sandbox.destroy();
 * ```
 */
export const railway = defineCompute<RailwayConfig>({
  provider: 'railway'
});
