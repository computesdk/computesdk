/**
 * Workbench command handlers
 * 
 * Core operations using factory providers directly
 */

import { escapeArgs } from '@computesdk/cmd';
import type { WorkbenchState } from './state.js';
import { getCurrentSandbox, setSandbox, clearSandbox, hasSandbox } from './state.js';
import { 
  Spinner, 
  logCommand, 
  logSuccess, 
  logError, 
  logWarning,
  c,
  formatDuration,
} from './output.js';
import {
  isProviderReady,
  autoDetectProvider,
  getProviderSetupHelp,
  isValidProvider,
  loadProvider,
  getProviderConfig,
  PROVIDER_NAMES,
  type ProviderName,
} from './providers.js';
import * as readline from 'readline';

/**
 * Prompt user for yes/no confirmation
 * Uses raw mode to read a single keypress without conflicting with REPL
 */
async function confirm(question: string, defaultYes = false, _state?: WorkbenchState): Promise<boolean> {
  const promptSuffix = defaultYes ? '(Y/n)' : '(y/N)';
  
  // Write prompt directly to stdout
  process.stdout.write(`${question} ${promptSuffix}: `);
  
  // Ensure stdin is in a readable state
  if (process.stdin.isPaused()) {
    process.stdin.resume();
  }
  
  return new Promise((resolve) => {
    // Set raw mode to get individual keypresses
    const wasRaw = process.stdin.isRaw;
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true);
    }
    
    const cleanup = (restoreRaw: boolean) => {
      process.stdin.removeListener('data', onData);
      if (process.stdin.isTTY && restoreRaw) {
        process.stdin.setRawMode(wasRaw || false);
      }
    };
    
    const onData = (key: Buffer) => {
      const char = key.toString();
      
      // Handle Ctrl+C
      if (char === '\x03') {
        process.stdout.write('^C\n');
        cleanup(true);
        resolve(false);
        return;
      }
      
      // Handle Enter (use default)
      if (char === '\r' || char === '\n') {
        process.stdout.write(defaultYes ? 'Y\n' : 'N\n');
        cleanup(true);
        resolve(defaultYes);
        return;
      }
      
      // Handle y/Y
      if (char === 'y' || char === 'Y') {
        process.stdout.write('y\n');
        cleanup(true);
        resolve(true);
        return;
      }
      
      // Handle n/N
      if (char === 'n' || char === 'N') {
        process.stdout.write('n\n');
        cleanup(true);
        resolve(false);
        return;
      }
      
      // Ignore other keys - wait for valid input
    };
    
    process.stdin.on('data', onData);
  });
}

/**
 * Prompt user to switch sandbox if one is already active
 * Returns true if should proceed with switch
 */
export async function confirmSandboxSwitch(state: WorkbenchState): Promise<boolean> {
  if (!hasSandbox(state)) {
    return true; // No current sandbox, no need to confirm
  }
  
  return await confirm('Switch to new sandbox?', true, state); // Default YES
}

/**
 * Auto-create sandbox if none exists
 */
export async function ensureSandbox(state: WorkbenchState): Promise<void> {
  if (hasSandbox(state)) {
    return; // Already have a sandbox
  }
  
  await createSandbox(state);
}

/**
 * Create or get compute instance for current provider configuration
 */
export async function getComputeInstance(state: WorkbenchState): Promise<any> {
  // Return cached instance if available
  if (state.compute) {
    return state.compute;
  }

  const providerName = state.currentProvider || autoDetectProvider(false);

  if (!providerName) {
    throw new Error('No provider configured.');
  }

  // Hyphenated provider names export under a camelCase identifier (e.g. 'just-bash' -> 'justBash')
  const exportName = providerName.replace(/-([a-z])/g, (_: string, c: string) => c.toUpperCase());
  const providerModule = await loadProvider(providerName as ProviderName);
  const providerFactory = providerModule[exportName] ?? providerModule[providerName];

  if (!providerFactory) {
    throw new Error(`Provider ${providerName} does not export a factory function`);
  }

  const config = getProviderConfig(providerName as ProviderName);
  const providerInstance = providerFactory(config);

  const { compute: directCompute } = await import('computesdk');
  const compute = directCompute({
    provider: providerInstance,
  });

  // Cache the instance
  state.compute = compute;
  return compute;
}

/**
 * Create a new sandbox using the configured direct provider
 */
export async function createSandbox(state: WorkbenchState): Promise<void> {
  const providerName = state.currentProvider || autoDetectProvider(false);

  if (!providerName) {
    logError('No provider configured. Run "env" to see setup instructions.');
    throw new Error('No provider available');
  }

  if (!isProviderReady(providerName)) {
    logError(`Provider ${providerName} is not fully configured.`);
    console.log(getProviderSetupHelp(providerName));
    throw new Error('Provider not ready');
  }

  const spinner = new Spinner(`Creating sandbox with ${providerName}...`).start();
  const startTime = Date.now();
  
  try {
    // Get or create compute instance
    const compute = await getComputeInstance(state);
    
    // Create sandbox
    const result = await compute.sandbox.create();
    const duration = Date.now() - startTime;
    
    setSandbox(state, result, providerName);
    spinner.succeed(`Sandbox ready ${c.dim(`(${formatDuration(duration)})`)}`);
  } catch (error) {
    const duration = Date.now() - startTime;
    spinner.fail(`Failed to create sandbox ${c.dim(`(${formatDuration(duration)})`)}`);
    
    // Better error message if provider package not installed
    if (error instanceof Error && error.message.includes('Cannot find module')) {
      logError(`Provider package @computesdk/${providerName} is not installed.`);
      console.log(`\nInstall it with: ${c.cyan(`npm install @computesdk/${providerName}`)}\n`);
    }
    
    // Show the actual error for debugging
    if (error instanceof Error) {
      logError(`Error: ${error.message}`);
      if (error.stack) {
        console.log(c.dim(error.stack));
      }
    }
    
    throw error;
  }
}

/**
 * Destroy current sandbox
 */
export async function destroySandbox(state: WorkbenchState): Promise<void> {
  const spinner = new Spinner('Destroying sandbox...').start();
  
  try {
    const sandbox = getCurrentSandbox(state);
    await sandbox.destroy();
    clearSandbox(state);
    spinner.succeed('Destroyed');
  } catch (error) {
    spinner.fail(`Failed to destroy: ${error instanceof Error ? error.message : String(error)}`);
    throw error;
  }
}

/**
 * Restart sandbox (destroy + create with same provider)
 */
export async function restartSandbox(state: WorkbenchState): Promise<void> {
  const provider = state.currentProvider;
  
  if (hasSandbox(state)) {
    await destroySandbox(state);
  }
  
  // Keep same provider
  if (provider) {
    state.currentProvider = provider;
  }
  
  await createSandbox(state);
}

/**
 * Run a command on the current sandbox
 */
export async function runCommand(state: WorkbenchState, command: string[]): Promise<any> {
  // Ensure we have a sandbox
  await ensureSandbox(state);
  
  const sandbox = getCurrentSandbox(state);
  const startTime = Date.now();
  
  logCommand(command);
  
  try {
    // Use escapeArgs to properly join and escape command array with spaces/special chars
    const commandString = escapeArgs(command);
    const result = await sandbox.runCommand(commandString);
    const duration = Date.now() - startTime;
    
    // Print output directly
    if (result.stdout) {
      console.log(result.stdout.trimEnd());
    }
    if (result.stderr) {
      console.error(c.red(result.stderr.trimEnd()));
    }
    
    // Show success indicator with timing and exit code info
    const exitCodeInfo = result.exitCode !== 0 ? c.yellow(` (exit ${result.exitCode})`) : '';
    logSuccess(`${c.dim(`${formatDuration(duration)}`)}${exitCodeInfo}`);
    
    // In verbose mode, return the full result object
    // Otherwise return undefined so REPL doesn't print anything
    if (state.verbose) {
      return result;
    }
    return undefined;
  } catch (error) {
    const duration = Date.now() - startTime;
    logError(`Failed ${c.dim(`(${formatDuration(duration)})`)} - ${error instanceof Error ? error.message : String(error)}`);

    // Clear stale sandbox on connection/auth errors so next command creates fresh
    if (isStaleConnectionError(error)) {
      clearSandbox(state);
      logWarning('Sandbox connection lost. Next command will create a new sandbox.');
    }

    throw error;
  }
}

/**
 * Check if an error indicates a stale/dead sandbox connection
 */
function isStaleConnectionError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;

  const message = error.message.toLowerCase();
  const stalePhrases = [
    'websocket',
    'connection refused',
    'connection reset',
    'connection closed',
    'socket hang up',
    'econnrefused',
    'econnreset',
    'etimedout',
    'not found',
    'sandbox not found',
    'unauthorized',
    '401',
    '403',
    '404',
  ];

  return stalePhrases.some(phrase => message.includes(phrase));
}

/**
 * Switch to a different provider
 *
 * Examples:
 *   provider e2b          → switch to e2b
 *   provider local        → connect to local daemon
 *   provider local list   → list local sandboxes
 */
export async function switchProvider(state: WorkbenchState, name: string, subcommand?: string): Promise<void> {
  // Handle "provider local" specially
  if (name === 'local') {
    if (subcommand === 'list') {
      await listLocalSandboxes();
      return;
    }
    // Connect to local daemon (subcommand is optional subdomain)
    await connectToLocal(state, subcommand);
    return;
  }

  // Validate provider
  if (!isValidProvider(name)) {
    logError(`Unknown provider: ${name}`);
    console.log(`Available providers: ${PROVIDER_NAMES.filter(p => p !== 'gateway').join(', ')}, local`);
    return;
  }

  // Check if direct provider is configured
  if (!isProviderReady(name)) {
    logError(`Provider ${name} is not fully configured.`);
    console.log(getProviderSetupHelp(name));
    return;
  }

  // Prompt to destroy current sandbox if exists
  if (hasSandbox(state)) {
    const shouldDestroy = await confirm('Destroy current sandbox?', false, state);
    if (shouldDestroy) {
      await destroySandbox(state);
      state.currentProvider = name;
      state.compute = null; // Clear compute instance so it gets recreated
      logSuccess(`Switched to ${name}`);
    } else {
      logWarning('Keeping current sandbox. Provider remains unchanged.');
    }
  } else {
    state.currentProvider = name;
    state.compute = null; // Clear compute instance so it gets recreated
    logSuccess(`Switched to ${name}`);
  }
}

/**
 * Create a provider command handler
 * Supports: provider <name>, provider local [list|<subdomain>]
 */
export function defineProviderCommand(state: WorkbenchState) {
  return async function provider(name?: string, subcommand?: string) {
    if (!name) {
      // Show current provider
      if (state.currentProvider) {
        const suffix = state.currentProvider === 'local' ? ' (local daemon)' : '';
        console.log(`\nCurrent provider: ${c.green(state.currentProvider)}${suffix}\n`);
      } else {
        console.log(c.yellow('\nNo provider selected\n'));
      }
      return;
    }

    await switchProvider(state, name, subcommand);
  };
}

/**
 * Toggle verbose mode
 */
export function toggleVerbose(state: WorkbenchState): void {
  state.verbose = !state.verbose;
  // Also enable SDK debug logging when verbose is on
  if (state.verbose) {
    process.env.COMPUTESDK_DEBUG = '1';
    logSuccess('Verbose mode enabled - will show full command results and SDK debug logs');
    console.log(c.dim('Commands will return full result objects with metadata\n'));
  } else {
    delete process.env.COMPUTESDK_DEBUG;
    logSuccess('Verbose mode disabled - showing clean output only');
    console.log(c.dim('Commands will only show stdout/stderr\n'));
  }
}

/**
 * Show verbose mode status
 */
export function showVerbose(state: WorkbenchState): void {
  const status = state.verbose ? c.green('enabled') : c.dim('disabled');
  console.log(`\nVerbose mode: ${status}`);
  
  if (state.verbose) {
    console.log(c.dim('Commands return full result objects with metadata'));
    console.log(c.dim('SDK debug logging is enabled'));
  } else {
    console.log(c.dim('Commands show only stdout/stderr'));
  }
  
  console.log(`\nToggle with: ${c.cyan('verbose')}\n`);
}

/**
 * Connect to an existing sandbox via URL
 * Useful for connecting to a locally running sandbox or a sandbox created elsewhere
 */
export async function connectToSandbox(state: WorkbenchState, sandboxUrl: string, token?: string): Promise<void> {
  // Validate URL format
  if (!sandboxUrl) {
    logError('Usage: connect <sandbox_url> [token]');
    console.log('Example: connect https://sandbox-123.localhost:8080');
    console.log('Example: connect https://sandbox-123.localhost:8080 your_access_token');
    return;
  }
  
  // Clean up URL (remove trailing slash)
  const cleanUrl = sandboxUrl.replace(/\/$/, '');
  
  // Disconnect from current sandbox if exists
  if (hasSandbox(state)) {
    const shouldDisconnect = await confirm('Disconnect from current sandbox?', false, state);
    if (!shouldDisconnect) {
      logWarning('Keeping current sandbox. Connection cancelled.');
      return;
    }
    // Just clear the reference, don't destroy since we don't own this sandbox
    clearSandbox(state);
  }
  
  const spinner = new Spinner(`Connecting to ${cleanUrl}...`).start();
  const startTime = Date.now();
  
  try {
    // Import Sandbox class from computesdk package (client is now merged into computesdk)
    const { Sandbox } = await import('computesdk');
    
    // Dynamically import WebSocket for Node.js environment
    let WebSocket: any;
    try {
      // @ts-expect-error - ws is an optional peer dependency that may not have type declarations
      const wsModule = await import('ws');
      WebSocket = wsModule.default;
    } catch {
      logError('Failed to import "ws" module. Please install it: pnpm add ws');
      throw new Error('Missing "ws" dependency');
    }
    
    // Create a Sandbox instance directly with optional token
    // WebSocket type comes from 'ws' module which may differ from browser WebSocket
    const sandbox = new Sandbox({
      sandboxUrl: cleanUrl,
      sandboxId: '', // Will be populated when we get info
      provider: 'connected', // Mark as directly connected
      token: token, // Optional access token
      WebSocket: WebSocket as typeof globalThis.WebSocket,
    });

    // Test the connection by getting sandbox info
    const info = await sandbox.getInfo();
    const duration = Date.now() - startTime;

    // Update state with the connected sandbox
    // Sandbox from @computesdk/client is the same class re-exported by computesdk
    setSandbox(state, sandbox, 'connected');
    
    spinner.succeed(`Connected to sandbox ${c.dim(`(${formatDuration(duration)})`)}`);
    console.log(c.dim(`Provider: ${info.provider || 'unknown'}`));
    console.log(c.dim(`Sandbox ID: ${info.id || 'unknown'}`));
  } catch (error) {
    const duration = Date.now() - startTime;
    spinner.fail(`Failed to connect ${c.dim(`(${formatDuration(duration)})`)}`);
    
    if (error instanceof Error) {
      logError(`Error: ${error.message}`);
      if (error.stack) {
        console.log(c.dim(error.stack));
      }
    }
    
    throw error;
  }
}

/**
 * Local daemon config structure (from ~/.compute/config.json)
 */
interface LocalConfig {
  access_token: string;
  main_subdomain: string;
  auth_enabled: boolean;
  sandboxes: Array<{
    subdomain: string;
    directory: string;
    is_main: boolean;
    created_at: string;
  }>;
}

/**
 * Read local daemon config from ~/.compute/config.json
 */
async function readLocalConfig(): Promise<LocalConfig | null> {
  const os = await import('os');
  const fs = await import('fs/promises');
  const path = await import('path');
  
  const configPath = path.join(os.homedir(), '.compute', 'config.json');
  
  try {
    const content = await fs.readFile(configPath, 'utf-8');
    return JSON.parse(content) as LocalConfig;
  } catch {
    return null;
  }
}

/**
 * Check if local daemon is running
 */
export async function isLocalDaemonRunning(): Promise<boolean> {
  const os = await import('os');
  const fs = await import('fs/promises');
  const path = await import('path');
  
  const pidPath = path.join(os.homedir(), '.compute', 'compute.pid');
  
  try {
    const pidContent = await fs.readFile(pidPath, 'utf-8');
    const pid = parseInt(pidContent.trim(), 10);
    
    // Check if process is running
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * List local sandboxes
 */
export async function listLocalSandboxes(): Promise<void> {
  const config = await readLocalConfig();
  
  if (!config) {
    logError('No local daemon config found at ~/.compute/config.json');
    console.log(c.dim('Run "compute start" to start the local daemon'));
    return;
  }
  
  const isRunning = await isLocalDaemonRunning();
  
  console.log('');
  console.log(c.bold('Local Daemon Status:'), isRunning ? c.green('Running') : c.red('Stopped'));
  console.log('');
  
  if (!config.sandboxes || config.sandboxes.length === 0) {
    console.log(c.dim('No sandboxes found'));
    return;
  }
  
  console.log(c.bold('Sandboxes:'));
  for (const sandbox of config.sandboxes) {
    const isMain = sandbox.subdomain === config.main_subdomain;
    const mainLabel = isMain ? c.green(' (main)') : '';
    console.log(`  ${c.cyan(sandbox.subdomain)}${mainLabel}`);
    console.log(c.dim(`    https://${sandbox.subdomain}.sandbox.computesdk.com`));
  }
  console.log('');
  console.log(c.dim(`Connect with: local ${config.main_subdomain}`));
  console.log('');
}

/**
 * Connect to a local daemon sandbox
 */
export async function connectToLocal(state: WorkbenchState, subdomain?: string): Promise<void> {
  const config = await readLocalConfig();
  
  if (!config) {
    logError('No local daemon config found at ~/.compute/config.json');
    console.log(c.dim('Run "compute start" to start the local daemon'));
    return;
  }
  
  const isRunning = await isLocalDaemonRunning();
  if (!isRunning) {
    logError('Local daemon is not running');
    console.log(c.dim('Run "compute start" to start the local daemon'));
    return;
  }
  
  // Use provided subdomain or default to main
  const targetSubdomain = subdomain || config.main_subdomain;
  
  // Verify sandbox exists
  const sandbox = config.sandboxes.find(s => s.subdomain === targetSubdomain);
  if (!sandbox) {
    logError(`Sandbox "${targetSubdomain}" not found`);
    console.log(c.dim('Run "local list" to see available sandboxes'));
    return;
  }
  
  const sandboxUrl = `https://${targetSubdomain}.sandbox.computesdk.com`;
  const token = config.access_token;
  
  // Disconnect from current sandbox if exists
  if (hasSandbox(state)) {
    const shouldDisconnect = await confirm('Disconnect from current sandbox?', false, state);
    if (!shouldDisconnect) {
      logWarning('Keeping current sandbox. Connection cancelled.');
      return;
    }
    clearSandbox(state);
  }
  
  const spinner = new Spinner(`Connecting to local sandbox ${targetSubdomain}...`).start();
  const startTime = Date.now();
  
  try {
    const { Sandbox } = await import('computesdk');
    
    // Dynamically import WebSocket for Node.js environment
    let WebSocket: any;
    try {
      // @ts-expect-error - ws is an optional peer dependency
      const wsModule = await import('ws');
      WebSocket = wsModule.default;
    } catch {
      spinner.fail('Failed to import "ws" module');
      logError('Please install ws: pnpm add ws');
      throw new Error('Missing "ws" dependency');
    }
    
    const sandboxInstance = new Sandbox({
      sandboxUrl,
      sandboxId: targetSubdomain,
      provider: 'local',
      token,
      WebSocket: WebSocket as typeof globalThis.WebSocket,
    });
    
    // Test the connection
    const info = await sandboxInstance.getInfo();
    const duration = Date.now() - startTime;
    
    setSandbox(state, sandboxInstance, 'local');
    
    // Enable verbose mode for local provider (useful for debugging)
    state.verbose = true;
    process.env.COMPUTESDK_DEBUG = '1';
    
    spinner.succeed(`Connected to local sandbox ${c.dim(`(${formatDuration(duration)})`)}`);
    console.log(c.dim(`Sandbox: ${targetSubdomain}`));
    console.log(c.dim(`URL: ${sandboxUrl}`));
    console.log(c.dim(`Verbose mode: enabled (for debugging)`));
  } catch (error) {
    const duration = Date.now() - startTime;
    spinner.fail(`Failed to connect ${c.dim(`(${formatDuration(duration)})`)}`);
    
    if (error instanceof Error) {
      logError(`Error: ${error.message}`);
    }
    
    throw error;
  }
}

/**
 * Cleanup on exit
 */
export async function cleanupOnExit(state: WorkbenchState, replServer?: any): Promise<void> {
  if (!hasSandbox(state)) {
    return;
  }
  
  // Pause the REPL to prevent input conflicts
  if (replServer) {
    replServer.pause();
  }
  
  console.log(''); // New line
  
  // Don't offer to destroy if we're just connected to an external sandbox
  if (state.currentProvider === 'connected') {
    logWarning('Disconnecting from external sandbox (not destroying).');
    return;
  }
  
  const shouldDestroy = await confirm('Destroy active sandbox?', false, state);
  
  if (shouldDestroy) {
    await destroySandbox(state);
  } else {
    logWarning('Sandbox left running. It may incur costs.');
  }
  
  // Resume not needed since we're exiting
}
