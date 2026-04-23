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
  const state = createState();

  state.availableProviders = getAvailableProviders();
  const detectedProvider = autoDetectProvider();

  const backendProviders = state.availableProviders.filter(p => p !== 'gateway');
  state.currentProvider = backendProviders[0] ?? detectedProvider;

  showWelcome(state.availableProviders, state.currentProvider);

  const replServer = createREPL(state);

  replServer.on('exit', async () => {
    await cleanupOnExit(state, replServer);
    process.exit(0);
  });
}
