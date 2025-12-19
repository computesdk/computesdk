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
  
  // Determine mode based on what's available
  const hasGateway = state.availableProviders.includes('gateway');
  const backendProviders = state.availableProviders.filter(p => p !== 'gateway');
  
  if (hasGateway && backendProviders.length > 0) {
    // Gateway is available - use it with first backend provider
    state.currentProvider = backendProviders[0] || 'e2b';
    state.useDirectMode = false; // Use gateway mode
  } else if (backendProviders.length > 0) {
    // No gateway, but we have direct providers - use direct mode
    state.currentProvider = backendProviders[0];
    state.useDirectMode = true; // Use direct mode
  } else {
    // No providers at all
    state.currentProvider = detectedProvider;
    state.useDirectMode = false;
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
