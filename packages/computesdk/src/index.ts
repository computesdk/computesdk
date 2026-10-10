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

// Universal Instance Interface & Types
//
// Note: The interface is renamed from "Instance" to "InstanceInterface" on
// export so provider-agnostic code has a canonical type name to reference.
// Sandbox* names are deprecated aliases kept for backwards compatibility.
export type {
  Instance as InstanceInterface,
  ComputeKind,
  CodeResult,
  CommandResult,
  InstanceInfo,
  Snapshot,
  FileEntry,
  RunCommandOptions,
  StartProcessOptions,
  ProcessStatus,
  ProcessHandle,
  InstanceFileSystem,
  CreateInstanceOptions,
  InstanceResourceOptions,
  RunloopLaunchParameters,
  VercelSandboxResources,
  InstanceEgressOptions,
  InstanceEgressInfo,
} from './types/universal-instance';

/** @deprecated Use {@link InstanceInterface}. */
export type { Sandbox as SandboxInterface } from './types/universal-sandbox';
export type {
  /** @deprecated Use {@link InstanceInfo}. */
  SandboxInfo,
  /** @deprecated Use {@link InstanceFileSystem}. */
  SandboxFileSystem,
  /** @deprecated Use {@link CreateInstanceOptions}. */
  CreateSandboxOptions,
  /** @deprecated Use {@link InstanceResourceOptions}. */
  SandboxResourceOptions,
  /** @deprecated Use {@link InstanceEgressOptions}. */
  SandboxEgressOptions,
  /** @deprecated Use {@link InstanceEgressInfo}. */
  SandboxEgressInfo,
} from './types/universal-sandbox';

// Egress router helpers
export { instanceEgressEnvVars } from './egress';
/** @deprecated Use {@link instanceEgressEnvVars}. */
export { sandboxEgressEnvVars } from './egress';

// Compute API
//
// Re-export daemon seed launcher helpers for command-daemon flows
export {
  daemonSeedScript,
  daemonSeedScriptCommand,
  parseSeedInvocationOutput,
} from 'daemond';
export type {
  SeedScriptConfig,
  SeedCommandInput,
  SeedStdinInput,
  SeedCloseStdinInput,
  SeedInput,
  SeedCommandResult,
  SeedInvocationResult,
  SeedDaemonInfo,
  SeedHealthPayload,
  SeedEventFilter,
} from 'daemond';

// Works as both callable `compute({...}).sandbox.create()` and singleton
// `compute.setConfig({...}); compute.sandbox.create()`.
export { compute } from './compute';
export type { CallableCompute, ExplicitComputeConfig } from './compute';
