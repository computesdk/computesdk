import type { Command } from '../types.js';

/**
 * ComputeSDK CLI installation and management utilities
 */

/**
 * Install the ComputeSDK CLI in a sandbox
 * 
 * This command downloads and runs the official ComputeSDK installer.
 * The CLI provides the full ComputeSDK API (terminals, watchers, signals, etc.)
 * in any sandbox environment.
 * 
 * @example
 * ```typescript
 * import { compute } from '@computesdk/cmd';
 * 
 * // Install compute in a raw E2B/Daytona/etc sandbox
 * await sandbox.runCommand(compute.install({ apiKey: process.env.COMPUTESDK_API_KEY }));
 * ```
 * 
 * @param options Installation options
 * @param options.apiKey ComputeSDK API key (or set COMPUTESDK_API_KEY env var)
 * @param options.version Specific version to install (default: latest)
 * @param options.silent Suppress installation output (default: false)
 * @returns Command tuple for installing the compute CLI
 */
export const install = (options?: {
  apiKey?: string;
  version?: string;
  silent?: boolean;
}): Command => {
  const installUrl = options?.version
    ? `https://computesdk.com/install.sh?version=${options.version}`
    : 'https://computesdk.com/install.sh';
  
  const curlFlags = options?.silent ? '-fsSL' : '-fSL';
  
  // Build the install command with optional API key
  let installCmd = `curl ${curlFlags} ${installUrl} | bash`;
  
  // If API key is provided, set it as environment variable for the install script
  if (options?.apiKey) {
    installCmd = `COMPUTESDK_API_KEY="${options.apiKey}" ${installCmd}`;
  } else if (typeof process !== 'undefined' && process.env?.COMPUTESDK_API_KEY) {
    // Fallback to process.env if available
    installCmd = `COMPUTESDK_API_KEY="${process.env.COMPUTESDK_API_KEY}" ${installCmd}`;
  }
  
  // Use sh -c to pipe curl output to bash
  return ['sh', '-c', installCmd];
};

/**
 * Check if the ComputeSDK CLI is installed
 * 
 * @example
 * ```typescript
 * import { compute } from '@computesdk/cmd';
 * 
 * const result = await sandbox.runCommand(compute.isInstalled());
 * const installed = result.exitCode === 0;
 * ```
 * 
 * @returns Command tuple that exits 0 if installed, 1 if not
 */
export const isInstalled = (): Command => {
  return ['sh', '-c', 'which compute > /dev/null 2>&1'];
};

/**
 * Get the installed compute version
 * 
 * @example
 * ```typescript
 * import { compute } from '@computesdk/cmd';
 * 
 * const result = await sandbox.runCommand(compute.version());
 * console.log('Version:', result.stdout.trim());
 * ```
 * 
 * @returns Command tuple to get compute version
 */
export const version = (): Command => {
  return ['compute', '--version'];
};

/**
 * Start the ComputeSDK daemon
 * 
 * Note: The daemon usually auto-starts after installation.
 * This is mainly useful for restarting or manual control.
 * 
 * @example
 * ```typescript
 * import { compute } from '@computesdk/cmd';
 * 
 * // With API key
 * await sandbox.runCommand(compute.start({ apiKey: process.env.COMPUTESDK_API_KEY }), { background: true });
 * 
 * // With access token
 * await sandbox.runCommand(compute.start({ accessToken: process.env.ACCESS_TOKEN }), { background: true });
 * ```
 * 
 * @param options Start options
 * @param options.apiKey ComputeSDK API key (or set COMPUTESDK_API_KEY env var)
 * @param options.accessToken Access token for authentication (alternative to apiKey)
 * @param options.port Port to listen on (default: 18080)
 * @param options.logLevel Log level (default: 'info')
 * @returns Command tuple to start the daemon
 */
export const start = (options?: {
  apiKey?: string;
  accessToken?: string;
  port?: number;
  logLevel?: 'debug' | 'info' | 'warn' | 'error';
}): Command => {
  const args = ['compute', 'start'];
  
  const apiKey = options?.apiKey || (typeof process !== 'undefined' && process.env?.COMPUTESDK_API_KEY);
  const accessToken = options?.accessToken;
  
  // Prefer access token over API key if both are provided
  if (accessToken) {
    args.push('--access-token', accessToken);
  } else if (apiKey) {
    args.push('--api-key', apiKey);
  }
  
  if (options?.port) {
    args.push('--port', String(options.port));
  }
  
  if (options?.logLevel === 'debug') {
    args.push('--verbose');
  }
  
  return args as Command;
};

/**
 * Stop the ComputeSDK daemon
 * 
 * @example
 * ```typescript
 * import { compute } from '@computesdk/cmd';
 * 
 * await sandbox.runCommand(compute.stop());
 * ```
 * 
 * @returns Command tuple to stop the daemon
 */
export const stop = (): Command => {
  return ['pkill', '-f', 'compute start'];
};

/**
 * Check daemon health status
 * 
 * @example
 * ```typescript
 * import { compute } from '@computesdk/cmd';
 * 
 * const result = await sandbox.runCommand(compute.health());
 * const healthy = result.exitCode === 0;
 * ```
 * 
 * @returns Command tuple to check daemon health
 */
export const health = (): Command => {
  return ['sh', '-c', 'curl -f http://localhost:3030/health > /dev/null 2>&1'];
};

/**
 * Install and start the ComputeSDK daemon in one command
 * 
 * This is a convenience method that installs the compute CLI and starts the daemon.
 * Useful for quickly setting up a sandbox with ComputeSDK capabilities.
 * 
 * @example
 * ```typescript
 * import { compute } from '@computesdk/cmd';
 * 
 * // Quick setup with API key
 * await sandbox.runCommand(compute.setup({ apiKey: process.env.COMPUTESDK_API_KEY }));
 * ```
 * 
 * @param options Setup options
 * @param options.apiKey ComputeSDK API key (or set COMPUTESDK_API_KEY env var)
 * @param options.accessToken Access token for authentication (alternative to apiKey)
 * @param options.port Port to listen on (default: 18080)
 * @param options.version Specific version to install (default: latest)
 * @param options.silent Suppress installation output (default: false)
 * @returns Command tuple for installing and starting the daemon
 */
export const setup = (options?: {
  apiKey?: string;
  accessToken?: string;
  port?: number;
  version?: string;
  silent?: boolean;
}): Command => {
  const apiKey = options?.apiKey || (typeof process !== 'undefined' && process.env?.COMPUTESDK_API_KEY);
  const accessToken = options?.accessToken;
  
  const installUrl = options?.version
    ? `https://computesdk.com/install.sh?version=${options.version}`
    : 'https://computesdk.com/install.sh';
  
  const curlFlags = options?.silent ? '-fsSL' : '-fSL';
  
  // Build install command
  let installCmd = `curl ${curlFlags} ${installUrl} | bash`;
  
  // Add API key to install if provided
  if (apiKey) {
    installCmd = `COMPUTESDK_API_KEY="${apiKey}" ${installCmd}`;
  }
  
  // Build start command
  let startCmd = 'compute start';
  
  // Add authentication flags
  if (accessToken) {
    startCmd += ` --access-token "${accessToken}"`;
  } else if (apiKey) {
    startCmd += ` --api-key "${apiKey}"`;
  }
  
  if (options?.port) {
    startCmd += ` --port ${options.port}`;
  }
  
  // Combine: install, then start in background
  const fullCmd = `${installCmd} && ${startCmd} > /dev/null 2>&1 &`;
  
  return ['sh', '-c', fullCmd];
};

/**
 * ComputeSDK CLI management utilities
 * 
 * @example
 * ```typescript
 * import { compute } from '@computesdk/cmd';
 * 
 * // Quick setup (install + start)
 * await sandbox.runCommand(compute.setup({ apiKey: process.env.COMPUTESDK_API_KEY }));
 * 
 * // Or install and start separately
 * await sandbox.runCommand(compute.install());
 * await sandbox.runCommand(compute.start({ apiKey: process.env.COMPUTESDK_API_KEY }));
 * 
 * // Check if installed
 * const result = await sandbox.runCommand(compute.isInstalled());
 * if (result.exitCode === 0) {
 *   console.log('Compute is installed!');
 * }
 * 
 * // Get version
 * const versionResult = await sandbox.runCommand(compute.version());
 * console.log('Version:', versionResult.stdout);
 * ```
 */
export const compute = {
  install,
  isInstalled,
  version,
  start,
  stop,
  health,
  setup,
};
