/**
 * ComputeSDK Workbench
 * 
 * Interactive REPL for testing sandbox lifecycle operations
 */

import { createState } from './state.js';
import { createREPL } from './repl.js';
import { showWelcome } from './output.js';
import { getAvailableProviders, autoDetectProvider } from './providers.js';
import { cleanupOnExit } from './commands.js';

/**
 * Start the workbench REPL
 */
export async function startWorkbench(): Promise<void> {
  // Create state
  const state = createState();
  
  // Detect available providers
  state.availableProviders = getAvailableProviders();
  state.currentProvider = autoDetectProvider();
  
  // Show welcome banner
  showWelcome(state.availableProviders, state.currentProvider);
  
  // Create REPL
  const replServer = createREPL(state);
  
  // Handle exit
  replServer.on('exit', async () => {
    await cleanupOnExit(state, replServer);
    process.exit(0);
  });
}
