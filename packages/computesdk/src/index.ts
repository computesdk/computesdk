/**
 * ComputeSDK - User-facing SDK
 *
 * Provides the universal Sandbox interface and compute API for executing code
 * in remote sandboxes via configured providers.
 *
 *   import { compute } from 'computesdk';
 *   import { e2b } from '@computesdk/e2b';
 *   import { modal } from '@computesdk/modal';
 *
 *   compute.setConfig({
 *     providers: [
 *       e2b({ apiKey: process.env.E2B_API_KEY }),
 *       modal({ tokenId: process.env.MODAL_TOKEN_ID, tokenSecret: process.env.MODAL_TOKEN_SECRET }),
 *     ],
 *   });
 */

// Universal Sandbox Interface & Types
//
// Note: The interface is renamed from "Sandbox" to "SandboxInterface" on export
// so provider-agnostic code has a canonical type name to reference.
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
  CreateSandboxOptions,
} from './types/universal-sandbox';

// Compute API
//
// Works as both callable `compute({...}).sandbox.create()` and singleton
// `compute.setConfig({...}); compute.sandbox.create()`.
export { compute } from './compute';
export type { CallableCompute, ExplicitComputeConfig } from './compute';
