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
  const detectedProvider = autoDetectProvider();
  
  // Default to gateway mode with first available provider
  if (detectedProvider === 'gateway') {
    // Gateway is available, pick first backend provider
    const backendProviders = state.availableProviders.filter(p => p !== 'gateway');
    state.currentProvider = backendProviders[0] || 'e2b';
    state.useDirectMode = false; // Default to gateway mode
  } else {
    state.currentProvider = detectedProvider;
    state.useDirectMode = false; // Default to gateway mode
  }
  
  // Show welcome banner
  showWelcome(state.availableProviders, state.currentProvider, state.useDirectMode);
  
  // Create REPL
  const replServer = createREPL(state);
  
  // Handle exit
  replServer.on('exit', async () => {
    await cleanupOnExit(state, replServer);
    process.exit(0);
  });
}
