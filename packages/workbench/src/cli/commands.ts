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
 * Create a new sandbox using factory provider
 */
export async function createSandbox(state: WorkbenchState): Promise<void> {
  const providerName = state.currentProvider || autoDetectProvider(state.forceGatewayMode);
  
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
    let compute;
    
    // Gateway uses zero-config mode, other providers use factory pattern
    if (providerName === 'gateway') {
      // Gateway mode: just use createCompute() with env auto-detection
      compute = createCompute();
    } else {
      // Load the provider package
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
    }
    
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
    throw error;
  }
}

/**
 * Switch to a different provider
 */
export async function switchProvider(state: WorkbenchState, newProvider: string): Promise<void> {
  // Validate provider
  if (!isValidProvider(newProvider)) {
    logError(`Unknown provider: ${newProvider}`);
    console.log(`Available providers: e2b, railway, daytona, modal, runloop, vercel, cloudflare, codesandbox, blaxel`);
    return;
  }
  
  // Check if configured
  if (!isProviderReady(newProvider)) {
    logError(`Provider ${newProvider} is not fully configured.`);
    console.log(getProviderSetupHelp(newProvider));
    return;
  }
  
  // Prompt to destroy current sandbox if exists
  if (hasSandbox(state)) {
    const shouldDestroy = await confirm('Destroy current sandbox?');
    if (shouldDestroy) {
      await destroySandbox(state);
      state.currentProvider = newProvider;
      logSuccess(`Switched to ${newProvider}`);
    } else {
      logWarning('Keeping current sandbox. Provider remains unchanged.');
    }
  } else {
    state.currentProvider = newProvider;
    logSuccess(`Switched to ${newProvider}`);
  }
}

/**
 * Create a provider command handler
 */
export function createProviderCommand(state: WorkbenchState) {
  return async function provider(name?: string) {
    if (!name) {
      // Show current provider
      if (state.currentProvider) {
        console.log(`\nCurrent provider: ${c.green(state.currentProvider)}\n`);
      } else {
        console.log(c.yellow('\nNo provider selected\n'));
      }
      return;
    }
    
    await switchProvider(state, name);
  };
}

/**
 * Toggle gateway mode on/off
 */
export async function toggleMode(state: WorkbenchState, mode?: 'gateway' | 'direct'): Promise<void> {
  const newMode = mode || (state.forceGatewayMode ? 'direct' : 'gateway');
  
  if (newMode === 'gateway') {
    state.forceGatewayMode = true;
    logSuccess('Switched to gateway mode 🌐');
    console.log(c.dim('Next sandbox will use gateway (requires COMPUTESDK_API_KEY)\n'));
    
    // If we have a sandbox and it's not gateway, suggest restart
    if (hasSandbox(state) && state.currentProvider !== 'gateway') {
      console.log(c.yellow('Current sandbox is in direct mode.'));
      console.log(c.dim('Run "restart" to switch to gateway mode\n'));
    }
  } else {
    state.forceGatewayMode = false;
    logSuccess('Switched to direct mode 🔗');
    console.log(c.dim('Next sandbox will use direct provider packages\n'));
    
    // If we have a sandbox and it's gateway, suggest restart
    if (hasSandbox(state) && state.currentProvider === 'gateway') {
      console.log(c.yellow('Current sandbox is in gateway mode.'));
      console.log(c.dim('Run "restart" to switch to direct mode\n'));
    }
  }
}

/**
 * Show current mode
 */
export function showMode(state: WorkbenchState): void {
  const mode = state.forceGatewayMode || state.currentProvider === 'gateway' ? 'gateway' : 'direct';
  const icon = mode === 'gateway' ? '🌐' : '🔗';
  
  console.log(`\nCurrent mode: ${c.green(mode)} ${icon}`);
  
  if (mode === 'gateway') {
    console.log(c.dim('Routes through ComputeSDK API (requires COMPUTESDK_API_KEY)'));
  } else {
    console.log(c.dim('Direct connection to providers (requires provider packages)'));
  }
  
  console.log(`\nToggle with: ${c.cyan('mode gateway')} or ${c.cyan('mode direct')}\n`);
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
