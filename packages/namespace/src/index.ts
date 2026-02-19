/**
 * Namespace Provider - Compute Factory
 *
 * Provides a first-class Namespace provider experience by routing all operations
 * through the ComputeSDK gateway. The gateway handles infrastructure provisioning
 * via @computesdk/gateway and installs the daemon for full sandbox capabilities.
 */

import { defineCompute, type ComputeConfig } from '@computesdk/provider';

/**
 * Namespace provider configuration
 */
export interface NamespaceConfig extends ComputeConfig {
  /** Namespace API token - if not provided, will fallback to NSC_TOKEN environment variable */
  token?: string;
  /** Virtual CPU cores for the instance */
  virtualCpu?: number;
  /** Memory in megabytes for the instance */
  memoryMegabytes?: number;
  /** Machine architecture (default: amd64) */
  machineArch?: string;
  /** Operating system (default: linux) */
  os?: string;
  /** Documented purpose for the instance */
  documentedPurpose?: string;
  /** Reason for destroying instances (default: "ComputeSDK cleanup") */
  destroyReason?: string;
}

/**
 * Namespace compute factory - creates configured compute instances
 *
 * Namespace is an infrastructure provider that becomes a full sandbox provider
 * via the ComputeSDK gateway. The gateway provisions Namespace instances with the
 * daemon pre-installed, enabling full sandbox capabilities.
 *
 * @example
 * ```typescript
 * import { namespace } from '@computesdk/namespace';
 *
 * const compute = namespace({
 *   token: 'nsc_xxx'
 * });
 *
 * // Full compute API available (routes through gateway)
 * const sandbox = await compute.sandbox.create();
 *
 * // Execute code
 * const result = await sandbox.runCode('console.log("Hello from Namespace!")');
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
export const namespace = defineCompute<NamespaceConfig>({
  provider: 'namespace'
});
