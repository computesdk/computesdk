/**
 * Render Provider - Compute Factory
 *
 * Provides a first-class Render provider experience by routing all operations
 * through the ComputeSDK gateway. The gateway handles infrastructure provisioning
 * via @computesdk/gateway and installs the daemon for full sandbox capabilities.
 */

import { defineCompute, type ComputeConfig } from '@computesdk/provider';

/**
 * Render provider configuration
 */
export interface RenderConfig extends ComputeConfig {
  /** Render API key - if not provided, will fallback to RENDER_API_KEY environment variable */
  apiKey?: string;
  /** Render Owner ID - if not provided, will fallback to RENDER_OWNER_ID environment variable */
  ownerId?: string;
}

/**
 * Render compute factory - creates configured compute instances
 *
 * Render is an infrastructure provider that becomes a full sandbox provider
 * via the ComputeSDK gateway. The gateway provisions Render services with the
 * daemon pre-installed, enabling full sandbox capabilities.
 *
 * @example
 * ```typescript
 * import { render } from '@computesdk/render';
 *
 * const compute = render({
 *   apiKey: 'render_xxx',
 *   ownerId: 'owner_xxx'
 * });
 *
 * // Full compute API available (routes through gateway)
 * const sandbox = await compute.sandbox.create();
 *
 * // Execute code
 * const result = await sandbox.runCode('console.log("Hello from Render!")');
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
export const render = defineCompute<RenderConfig>({
  provider: 'render'
});
