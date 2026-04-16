/**
 * ComputeSDK - User-facing SDK
 *
 * Provides the universal Sandbox class and compute API for executing code in remote sandboxes.
 *
 * Using ComputeSDK (Recommended):
 *   import { compute } from 'computesdk';
 *   
 *   Direct provider mode:
 *   import { e2b } from '@computesdk/e2b';
 *   import { modal } from '@computesdk/modal';
 *   compute.setConfig({
 *     providers: [
 *       e2b({ apiKey: process.env.E2B_API_KEY }),
 *       modal({ tokenId: process.env.MODAL_TOKEN_ID, tokenSecret: process.env.MODAL_TOKEN_SECRET }),
 *     ]
 *   })
 *
 * Using Providers Directly (Advanced):
 *   import { e2b } from '@computesdk/e2b';
 *   const compute = e2b({ apiKey: '...' });
 *   
 *   Useful for local providers (Docker) or provider-specific features
 */

// ============================================================================
// Universal Sandbox Interface & Types  
// ============================================================================

// Export universal Sandbox interface and supporting types
// These are the canonical type definitions that all providers should use
//
// Note: The interface is renamed from "Sandbox" to "SandboxInterface" on export
// to avoid collision with the Sandbox class below. Use "SandboxInterface"
// when writing provider-agnostic code that accepts any sandbox implementation.
export type {
  Sandbox as SandboxInterface,
  Runtime,
  CodeResult,
  CommandResult,
  SandboxInfo,
  Snapshot,
  FileEntry,
  RunCommandOptions,
  SandboxFileSystem,
  CreateSandboxOptions
} from './types/universal-sandbox';

// ============================================================================
// Sandbox Client
// ============================================================================

// Export Sandbox class (implements the SandboxInterface above)
//
// Usage guide:
// - import { Sandbox } from 'computesdk'           → Sandbox client class (for runtime use)
// - import type { SandboxInterface } from 'computesdk'  → Universal interface (for type annotations)
//
// Use the class when working with daemon-backed sandbox endpoints directly.
// Use the interface when writing functions that accept any sandbox implementation.
export { Sandbox } from './client';

// Export client-specific types
export type { SandboxStatus, ProviderSandboxInfo } from './client/types';
export { CommandExitError, isCommandExitError } from './client/types';

// Export setup payload helpers
export { buildSetupPayload, encodeSetupPayload, type SetupPayload, type SetupOverlayConfig } from './setup';

// Re-export commonly used client utilities
export {
  TerminalInstance,
  FileWatcher,
  SignalService,
  encodeBinaryMessage,
  decodeBinaryMessage,
  MessageType
} from './client';

// Export WebSocket type for Node.js environments without native WebSocket
export type { WebSocketConstructor } from './client';

// ============================================================================
// Compute API - Direct Provider Implementation
// ============================================================================

// Export compute singleton/callable - the main API
// Works as both: compute.sandbox.create() and compute({...}).sandbox.create()
export { compute } from './compute';
export type { CallableCompute, ExplicitComputeConfig } from './compute';
