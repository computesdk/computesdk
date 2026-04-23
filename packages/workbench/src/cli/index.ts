/**
 * ComputeSDK Workbench
 * 
 * Interactive REPL for testing sandbox lifecycle operations
 */

import { createState } from './state.js';
import { createREPL } from './repl.js';
import { showWelcome } from './output.js';
import { getAvailableProviders, autoDetectProvider } from './providers.js';
import { cleanupOnExit, isLocalDaemonRunning, connectToLocal } from './commands.js';

/**
 * Start the workbench REPL
 */
export async function startWorkbench(): Promise<void> {
  // Create state
  const state = createState();
  
  // Check if local daemon is available first
  const localDaemonRunning = await isLocalDaemonRunning();
  
  // Detect available providers
  state.availableProviders = getAvailableProviders();
  if (localDaemonRunning) {
    state.availableProviders.push('local');
  }
  const detectedProvider = autoDetectProvider();
  
  // Pick initial provider
  // Priority: local > first configured backend > detected
  if (localDaemonRunning) {
    state.currentProvider = 'local';
    state.verbose = true; // Enable verbose for local debugging
    process.env.COMPUTESDK_DEBUG = '1'; // Enable SDK debug logging
  } else {
    const backendProviders = state.availableProviders.filter(p => p !== 'gateway' && p !== 'local');
    state.currentProvider = backendProviders[0] ?? detectedProvider;
  }

  // Show welcome banner
  showWelcome(state.availableProviders, state.currentProvider, localDaemonRunning);
  
  // Create REPL
  const replServer = createREPL(state);
  
  // Auto-connect to local daemon if available
  if (localDaemonRunning) {
    try {
      await connectToLocal(state);
    } catch {
      // Silently fail - user can manually connect
    }
  }
  
  // Handle exit
  replServer.on('exit', async () => {
    await cleanupOnExit(state, replServer);
    process.exit(0);
  });
}
