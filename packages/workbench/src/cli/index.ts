/**
 * ComputeSDK Workbench
 *
 * Interactive REPL for testing sandbox lifecycle operations
 */

import { createState } from './state.js';
import { createREPL } from './repl.js';
import { showWelcome } from './output.js';
import { getAvailableProviders } from './providers.js';
import { cleanupOnExit } from './commands.js';

/**
 * Start the workbench REPL
 */
export async function startWorkbench(): Promise<void> {
  const state = createState();

  state.availableProviders = getAvailableProviders();
  state.currentProvider = state.availableProviders[0] ?? null;

  showWelcome(state.availableProviders, state.currentProvider);

  const replServer = createREPL(state);

  replServer.on('exit', async () => {
    await cleanupOnExit(state, replServer);
    process.exit(0);
  });
}
