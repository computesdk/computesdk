/**
 * Workbench command handlers
 * 
 * Core operations using factory providers directly
 */

import { createCompute } from 'computesdk';
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
  type ProviderName,
} from './providers.js';
import * as readline from 'readline';

/**
 * Prompt user for yes/no confirmation
 */
async function confirm(question: string): Promise<boolean> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    
    // Clear any pending input
    process.stdin.resume();
    
    rl.question(`${question} (y/N): `, (answer) => {
      rl.close();
      // Trim the answer to handle any extra characters
      const trimmed = answer.trim().toLowerCase();
      resolve(trimmed === 'y' || trimmed === 'yes');
    });
  });
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
 * Create a new sandbox using gateway or direct provider
 */
export async function createSandbox(state: WorkbenchState): Promise<void> {
  const providerName = state.currentProvider || autoDetectProvider(false);
  const useDirect = state.useDirectMode;
  
  if (!providerName) {
    logError('No provider configured. Run "env" to see setup instructions.');
    throw new Error('No provider available');
  }
  
  // Determine which mode to use
  let modeLabel: string;
  let actualProviderName: string;
  
  if (useDirect) {
    // Direct mode: use the provider directly
    modeLabel = `${providerName} (direct)`;
    actualProviderName = providerName;
    
    if (!isProviderReady(providerName)) {
      logError(`Provider ${providerName} is not fully configured for direct mode.`);
      console.log(getProviderSetupHelp(providerName));
      throw new Error('Provider not ready');
    }
  } else {
    // Gateway mode: use gateway with specified backend
    modeLabel = `${providerName} (via gateway)`;
    actualProviderName = 'gateway';
    
    if (!isProviderReady('gateway')) {
      logError('Gateway mode requires COMPUTESDK_API_KEY');
      console.log(getProviderSetupHelp('gateway'));
      throw new Error('Gateway not ready');
    }
  }
  
  const spinner = new Spinner(`Creating sandbox with ${modeLabel}...`).start();
  const startTime = Date.now();
  
  try {
    let compute;
    
    if (useDirect) {
      // Direct mode: load the provider package directly
      const providerModule = await loadProvider(providerName as ProviderName);
      const providerFactory = providerModule[providerName];
      
      if (!providerFactory) {
        throw new Error(`Provider ${providerName} does not export a factory function`);
      }
      
      // Get config from environment
      const config = getProviderConfig(providerName as ProviderName);
      
      // Create compute instance with this provider
      compute = createCompute({
        defaultProvider: providerFactory(config),
      });
    } else {
      // Gateway mode: use gateway with provider hint and credentials
      const gatewayModule = await import('computesdk');
      const gatewayFactory = gatewayModule.gateway;
      
      // Get provider-specific credentials to pass to gateway
      const providerConfig = getProviderConfig(providerName as ProviderName);
      
      // Map provider config to provider headers for gateway
      const providerHeaders: Record<string, string> = {};
      
      // Add provider-specific auth headers based on the provider
      switch (providerName) {
        case 'e2b':
          if (providerConfig.apiKey) providerHeaders['X-E2B-API-Key'] = providerConfig.apiKey;
          break;
        case 'railway':
          if (providerConfig.apiKey) providerHeaders['X-Railway-API-Key'] = providerConfig.apiKey;
          if (providerConfig.projectId) providerHeaders['X-Railway-Project-ID'] = providerConfig.projectId;
          if (providerConfig.environmentId) providerHeaders['X-Railway-Environment-ID'] = providerConfig.environmentId;
          break;
        case 'daytona':
          if (providerConfig.apiKey) providerHeaders['X-Daytona-API-Key'] = providerConfig.apiKey;
          break;
        case 'modal':
          if (providerConfig.tokenId) providerHeaders['X-Modal-Token-ID'] = providerConfig.tokenId;
          if (providerConfig.tokenSecret) providerHeaders['X-Modal-Token-Secret'] = providerConfig.tokenSecret;
          break;
        case 'vercel':
          if (providerConfig.token) providerHeaders['X-Vercel-Token'] = providerConfig.token;
          if (providerConfig.teamId) providerHeaders['X-Vercel-Team-ID'] = providerConfig.teamId;
          if (providerConfig.projectId) providerHeaders['X-Vercel-Project-ID'] = providerConfig.projectId;
          break;
        // Add other providers as needed
      }
      
      const config = {
        apiKey: process.env.COMPUTESDK_API_KEY!,
        provider: providerName, // Tell gateway which backend to use
        providerHeaders, // Pass provider credentials via headers
      };
      
      compute = createCompute({
        defaultProvider: gatewayFactory(config),
      });
    }
    
    // Create sandbox
    const result = await compute.sandbox.create();
    const duration = Date.now() - startTime;
    
    // Store compute instance in state for named sandbox operations
    state.compute = compute;
    
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
  if (!hasSandbox(state)) {
    logWarning('No active sandbox');
    return;
  }
  
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
    const result = await sandbox.runCommand(command[0], command.slice(1));
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
 * Supports both gateway mode (default) and direct mode
 * 
 * Examples:
 *   provider e2b          → gateway with e2b backend
 *   provider direct e2b   → direct connection to e2b
 */
export async function switchProvider(state: WorkbenchState, mode: string, providerName?: string): Promise<void> {
  // Parse the command: could be "provider e2b" or "provider direct e2b"
  let useDirect = false;
  let actualProvider = mode;
  
  if (mode === 'direct') {
    if (!providerName) {
      logError('Usage: provider direct <name>');
      console.log('Example: provider direct e2b');
      return;
    }
    useDirect = true;
    actualProvider = providerName;
  } else if (mode === 'gateway') {
    if (!providerName) {
      logError('Usage: provider gateway <name>');
      console.log('Example: provider gateway e2b');
      return;
    }
    useDirect = false;
    actualProvider = providerName;
  }
  
  // Remove 'gateway' prefix if someone types "provider gateway"
  if (actualProvider === 'gateway') {
    actualProvider = autoDetectProvider(false) || 'e2b';
  }
  
  // Validate provider
  if (!isValidProvider(actualProvider)) {
    logError(`Unknown provider: ${actualProvider}`);
    console.log(`Available providers: e2b, railway, daytona, modal, runloop, vercel, cloudflare, codesandbox, blaxel`);
    return;
  }
  
  // Check if gateway is configured (always needed)
  if (!useDirect && !isProviderReady('gateway')) {
    logError('Gateway mode requires COMPUTESDK_API_KEY');
    console.log(getProviderSetupHelp('gateway'));
    return;
  }
  
  // Check if direct provider is configured (only for direct mode)
  if (useDirect && !isProviderReady(actualProvider)) {
    logError(`Provider ${actualProvider} is not fully configured for direct mode.`);
    console.log(getProviderSetupHelp(actualProvider));
    return;
  }
  
  // Prompt to destroy current sandbox if exists
  if (hasSandbox(state)) {
    const shouldDestroy = await confirm('Destroy current sandbox?');
    if (shouldDestroy) {
      await destroySandbox(state);
      state.currentProvider = actualProvider;
      state.useDirectMode = useDirect;
      const modeStr = useDirect ? `${actualProvider} (direct)` : `${actualProvider} (via gateway)`;
      logSuccess(`Switched to ${modeStr}`);
    } else {
      logWarning('Keeping current sandbox. Provider remains unchanged.');
    }
  } else {
    state.currentProvider = actualProvider;
    state.useDirectMode = useDirect;
    const modeStr = useDirect ? `${actualProvider} (direct)` : `${actualProvider} (via gateway)`;
    logSuccess(`Switched to ${modeStr}`);
  }
}

/**
 * Create a provider command handler
 * Supports: provider e2b, provider direct e2b, provider gateway e2b
 */
export function createProviderCommand(state: WorkbenchState) {
  return async function provider(mode?: string, providerName?: string) {
    if (!mode) {
      // Show current provider
      if (state.currentProvider) {
        const modeStr = state.useDirectMode ? 'direct' : 'via gateway';
        console.log(`\nCurrent provider: ${c.green(state.currentProvider)} (${modeStr})\n`);
      } else {
        console.log(c.yellow('\nNo provider selected\n'));
      }
      return;
    }
    
    await switchProvider(state, mode, providerName);
  };
}

/**
 * Toggle between gateway and direct mode
 */
export async function toggleMode(state: WorkbenchState, mode?: 'gateway' | 'direct'): Promise<void> {
  const newMode = mode || (state.useDirectMode ? 'gateway' : 'direct');
  
  if (newMode === 'direct') {
    state.useDirectMode = true;
    logSuccess('Switched to direct mode 🔗');
    console.log(c.dim('Next sandbox will use direct provider packages\n'));
    
    // If we have a sandbox and it's in gateway mode, suggest restart
    if (hasSandbox(state) && !state.useDirectMode) {
      console.log(c.yellow('Current sandbox is in gateway mode.'));
      console.log(c.dim('Run "restart" to switch to direct mode\n'));
    }
  } else {
    state.useDirectMode = false;
    logSuccess('Switched to gateway mode 🌐');
    console.log(c.dim('Next sandbox will use gateway (requires COMPUTESDK_API_KEY)\n'));
    
    // If we have a sandbox and it's in direct mode, suggest restart
    if (hasSandbox(state) && state.useDirectMode) {
      console.log(c.yellow('Current sandbox is in direct mode.'));
      console.log(c.dim('Run "restart" to switch to gateway mode\n'));
    }
  }
}

/**
 * Show current mode
 */
export function showMode(state: WorkbenchState): void {
  const mode = state.useDirectMode ? 'direct' : 'gateway';
  const icon = mode === 'gateway' ? '🌐' : '🔗';
  
  console.log(`\nCurrent mode: ${c.green(mode)} ${icon}`);
  
  if (mode === 'gateway') {
    console.log(c.dim('Routes through ComputeSDK API (requires COMPUTESDK_API_KEY)'));
  } else {
    console.log(c.dim('Direct connection to providers (requires provider packages)'));
  }
  
  console.log(`\nSwitch with: ${c.cyan('provider e2b')} (gateway) or ${c.cyan('provider direct e2b')} (direct)\n`);
}

/**
 * Toggle verbose mode
 */
export function toggleVerbose(state: WorkbenchState): void {
  state.verbose = !state.verbose;
  if (state.verbose) {
    logSuccess('Verbose mode enabled - will show full command results');
    console.log(c.dim('Commands will return full result objects with metadata\n'));
  } else {
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
  } else {
    console.log(c.dim('Commands show only stdout/stderr'));
  }
  
  console.log(`\nToggle with: ${c.cyan('verbose')}\n`);
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
  const shouldDestroy = await confirm('Destroy active sandbox?');
  
  if (shouldDestroy) {
    await destroySandbox(state);
  } else {
    logWarning('Sandbox left running. It may incur costs.');
  }
  
  // Resume not needed since we're exiting
}
