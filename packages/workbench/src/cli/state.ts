/**
 * Workbench State Management
 *
 * Tracks current sandbox and provider state in-memory (no persistence)
 */

import type { Sandbox, ProviderSandbox } from 'computesdk';

/** Sandbox can be either client Sandbox (gateway mode) or ProviderSandbox (direct mode) */
type WorkbenchSandbox = Sandbox | ProviderSandbox;

/**
 * Workbench session state
 */
export interface WorkbenchState {
  /** Currently active provider (e2b, railway, etc.) */
  currentProvider: string | null;

  /** Current sandbox instance */
  currentSandbox: WorkbenchSandbox | null;
  
  /** When the current sandbox was created */
  sandboxCreatedAt: Date | null;
  
  /** List of providers detected from environment */
  availableProviders: string[];
  
  /** Whether to use direct mode (true) or gateway mode (false, default) */
  useDirectMode: boolean;
  
  /** Show verbose command output (full result object) */
  verbose: boolean;
  
  /** Internal: REPL server reference for updating prompt */
  _replServer?: any;
}

/**
 * Create initial workbench state
 */
export function createState(): WorkbenchState {
  return {
    currentProvider: null,
    currentSandbox: null,
    sandboxCreatedAt: null,
    availableProviders: [],
    useDirectMode: false,  // Default to gateway mode
    verbose: false,
  };
}

/**
 * Get current sandbox, throwing if none exists
 */
export function getCurrentSandbox(state: WorkbenchState): WorkbenchSandbox {
  if (!state.currentSandbox) {
    throw new Error('No active sandbox');
  }
  return state.currentSandbox;
}

/**
 * Set current sandbox
 */
export function setSandbox(state: WorkbenchState, sandbox: WorkbenchSandbox, provider: string) {
  state.currentSandbox = sandbox;
  state.currentProvider = provider;
  state.sandboxCreatedAt = new Date();
  updatePromptIfNeeded(state);
}

/**
 * Clear current sandbox
 */
export function clearSandbox(state: WorkbenchState) {
  state.currentSandbox = null;
  state.sandboxCreatedAt = null;
  updatePromptIfNeeded(state);
}

/**
 * Update REPL prompt if replServer is available
 * @internal
 */
function updatePromptIfNeeded(state: WorkbenchState) {
  if (state._replServer) {
    const prompt = getPrompt(state);
    state._replServer.setPrompt(prompt);
  }
}

/**
 * Get prompt string based on current state
 * @internal
 */
function getPrompt(state: WorkbenchState): string {
  if (!state.currentSandbox) {
    return '> ';
  }
  
  const provider = state.currentProvider || 'unknown';
  const sandboxId = (state.currentSandbox as any).sandboxId || '';
  
  // Use full sandbox ID for now
  // User can see exactly which sandbox they're connected to
  return `${provider}:${sandboxId}> `;
}

/**
 * Check if a sandbox is currently active
 */
export function hasSandbox(state: WorkbenchState): boolean {
  return state.currentSandbox !== null;
}

/**
 * Get sandbox uptime in seconds
 */
export function getUptimeSeconds(state: WorkbenchState): number {
  if (!state.sandboxCreatedAt) return 0;
  return Math.floor((Date.now() - state.sandboxCreatedAt.getTime()) / 1000);
}

/**
 * Format uptime as human-readable string
 */
export function formatUptime(state: WorkbenchState): string {
  const seconds = getUptimeSeconds(state);
  
  if (seconds < 60) {
    return `${seconds} second${seconds === 1 ? '' : 's'}`;
  }
  
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes} minute${minutes === 1 ? '' : 's'}`;
  }
  
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return `${hours}h ${remainingMinutes}m`;
}
