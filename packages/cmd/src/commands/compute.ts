import type { Command } from '../types.js';

/**
 * ComputeSDK CLI installation and management utilities
 */

/**
 * Detect if we're running in an interactive TTY environment.
 * Checks both stdin and stdout since either being a TTY indicates interactive use.
 */
const isTTYEnvironment = (): boolean => {
  if (typeof process === 'undefined') return false;
  return Boolean(process.stdin?.isTTY || process.stdout?.isTTY);
};

/**
 * Install the ComputeSDK CLI in a sandbox
 *
 * This command downloads and runs the official ComputeSDK installer.
 * The CLI provides the full ComputeSDK API (terminals, watchers, signals, etc.)
 * in any sandbox environment.
 *
 * By default, interactive mode is only enabled when running in a TTY environment.
 * In non-TTY environments (CI pipelines, scripts), the installer runs non-interactively.
 *
 * @example
 * ```typescript
 * import { compute } from '@computesdk/cmd';
 *
 * // Install compute in a raw E2B/Daytona/etc sandbox
 * await sandbox.runCommand(compute.install({ apiKey: process.env.COMPUTESDK_API_KEY }));
 *
 * // Force interactive mode (allow prompts)
 * await sandbox.runCommand(compute.install({ interactive: true }));
 * ```
 *
 * @param options Installation options
 * @param options.apiKey ComputeSDK API key (or set COMPUTESDK_API_KEY env var)
 * @param options.version Specific version to install (default: latest)
 * @param options.silent Suppress installation output (default: false)
 * @param options.interactive Enable interactive mode with prompts (default: auto-detected based on TTY)
 * @returns Command tuple for installing the compute CLI
 */
export const install = (options?: {
  apiKey?: string;
  version?: string;
  silent?: boolean;
  interactive?: boolean;
}): Command => {
  const installUrl = options?.version
    ? `https://computesdk.com/install.sh?version=${options.version}`
    : 'https://computesdk.com/install.sh';

  const curlFlags = options?.silent ? '-fsSL' : '-fSL';

  // Auto-detect interactive mode: default to interactive only when in a TTY
  const isInteractive = options?.interactive ?? isTTYEnvironment();

  // Build the install command with optional flags
  let installCmd = isInteractive
    ? `curl ${curlFlags} ${installUrl} | bash -s`
    : `curl ${curlFlags} ${installUrl} | bash -s -- --non-interactive`;

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
 *
 * // Wait for daemon to be healthy before returning (useful for CI/CD)
 * await sandbox.runCommand(compute.start({ apiKey: 'key', wait: true }));
 *
 * // Wait with custom timeout
 * await sandbox.runCommand(compute.start({ apiKey: 'key', wait: true, waitTimeout: 60 }));
 * ```
 *
 * @param options Start options
 * @param options.apiKey ComputeSDK API key (or set COMPUTESDK_API_KEY env var)
 * @param options.accessToken Access token for authentication (alternative to apiKey)
 * @param options.port Port to listen on (default: 18080)
 * @param options.logLevel Log level (default: 'info')
 * @param options.wait Wait for daemon to be healthy before returning (default: false)
 * @param options.waitTimeout Timeout in seconds when waiting for health (default: 30)
 * @returns Command tuple to start the daemon
 */
export const start = (options?: {
  apiKey?: string;
  accessToken?: string;
  port?: number;
  logLevel?: 'debug' | 'info' | 'warn' | 'error';
  wait?: boolean;
  waitTimeout?: number;
}): Command => {
  const args = ['compute', 'start'];

  const apiKey =
    options?.apiKey || (typeof process !== 'undefined' && process.env?.COMPUTESDK_API_KEY);
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

  if (options?.wait) {
    args.push('--wait');
    if (options.waitTimeout) {
      args.push('--wait-timeout', String(options.waitTimeout));
    }
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
 * @param options Health check options
 * @param options.host Host to check (default: 'localhost')
 * @param options.port Port to check (default: 18080)
 * @returns Command tuple to check daemon health
 */
export const health = (options?: {
  host?: string;
  port?: number;
}): Command => {
  const host = options?.host || 'localhost';
  const port = options?.port || 18080;
  return ['sh', '-c', `curl -f http://${host}:${port}/health > /dev/null 2>&1`];
};

/**
 * Check if compute daemon is set up and running
 * 
 * Returns exit code 0 if daemon is installed and running (ready to use)
 * Returns exit code 1 if setup is needed (not installed or not running)
 * 
 * @example
 * ```typescript
 * import { compute } from '@computesdk/cmd';
 * 
 * const result = await sandbox.runCommand(compute.isSetup());
 * if (result.exitCode === 0) {
 *   console.log('Daemon is ready!');
 * } else {
 *   console.log('Setup needed');
 *   await sandbox.runCommand(compute.setup({ apiKey: 'key' }));
 * }
 * ```
 * 
 * @param options Setup check options
 * @param options.host Host to check (default: 'localhost')
 * @param options.port Port to check (default: 18080)
 * @returns Command that exits 0 if setup, 1 if setup needed
 */
export const isSetup = (options?: {
  host?: string;
  port?: number;
}): Command => {
  const host = options?.host || 'localhost';
  const port = options?.port || 18080;
  
  return ['sh', '-c', `
    if ! which compute > /dev/null 2>&1; then
      exit 1
    fi
    if ! curl -f http://${host}:${port}/health > /dev/null 2>&1; then
      exit 1
    fi
    exit 0
  `.trim()];
};

/**
 * Install and start the ComputeSDK daemon in one command
 *
 * This is a convenience method that installs the compute CLI and starts the daemon.
 * Useful for quickly setting up a sandbox with ComputeSDK capabilities.
 *
 * By default, interactive mode is only enabled when running in a TTY environment.
 * In non-TTY environments (CI pipelines, scripts), the installer runs non-interactively.
 *
 * @example
 * ```typescript
 * import { compute } from '@computesdk/cmd';
 *
 * // Quick setup with API key
 * await sandbox.runCommand(compute.setup({ apiKey: process.env.COMPUTESDK_API_KEY }));
 *
 * // Force interactive mode (allow prompts)
 * await sandbox.runCommand(compute.setup({ apiKey: 'key', interactive: true }));
 *
 * // Wait for daemon to be healthy before returning (useful for CI/CD)
 * await sandbox.runCommand(compute.setup({ apiKey: 'key', wait: true }));
 * ```
 *
 * @param options Setup options
 * @param options.apiKey ComputeSDK API key (or set COMPUTESDK_API_KEY env var)
 * @param options.accessToken Access token for authentication (alternative to apiKey)
 * @param options.port Port to listen on (default: 18080)
 * @param options.version Specific version to install (default: latest)
 * @param options.silent Suppress installation output (default: false)
 * @param options.interactive Enable interactive mode with prompts (default: auto-detected based on TTY)
 * @param options.wait Wait for daemon to be healthy before returning (default: false)
 * @param options.waitTimeout Timeout in seconds when waiting for health (default: 30)
 * @returns Command tuple for installing and starting the daemon
 */
export const setup = (options?: {
  apiKey?: string;
  accessToken?: string;
  port?: number;
  version?: string;
  silent?: boolean;
  interactive?: boolean;
  wait?: boolean;
  waitTimeout?: number;
}): Command => {
  const apiKey = options?.apiKey || (typeof process !== 'undefined' && process.env?.COMPUTESDK_API_KEY);
  const accessToken = options?.accessToken;

  const installUrl = options?.version
    ? `https://computesdk.com/install.sh?version=${options.version}`
    : 'https://computesdk.com/install.sh';

  const curlFlags = options?.silent ? '-fsSL' : '-fSL';

  // Auto-detect interactive mode: default to interactive only when in a TTY
  const isInteractive = options?.interactive ?? isTTYEnvironment();

  // Build install command with optional flags
  let installCmd = isInteractive
    ? `curl ${curlFlags} ${installUrl} | bash -s`
    : `curl ${curlFlags} ${installUrl} | bash -s -- --non-interactive`;

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

  if (options?.wait) {
    startCmd += ' --wait';
    if (options.waitTimeout) {
      startCmd += ` --wait-timeout ${options.waitTimeout}`;
    }
  }

  // Combine: install, then start
  // If waiting, run in foreground so we block until healthy
  // Otherwise run in background for backwards compatibility
  const fullCmd = options?.wait
    ? `${installCmd} && ${startCmd}`
    : `${installCmd} && ${startCmd} > /dev/null 2>&1 &`;

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
  isSetup,
};
