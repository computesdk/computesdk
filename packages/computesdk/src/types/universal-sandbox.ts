/**
 * Universal Sandbox Types — deprecated aliases
 *
 * The "sandbox" namespace collapsed into "instance" so every form of compute
 * (sandboxes, VMs, baremetal) shares one interface. These aliases keep older
 * imports working; new code should use the Instance* names from
 * `./universal-instance` (re-exported alongside these from `types/index.ts`).
 */

import type {
  Instance,
  InstanceInfo,
  InstanceFileSystem,
  InstanceResourceOptions,
  InstanceEgressOptions,
  InstanceEgressInfo,
  CreateInstanceOptions,
} from './universal-instance';

// Non-renamed types stay re-exported so deep imports of this file keep working.
export type {
  ComputeKind,
  CodeResult,
  CommandResult,
  FileEntry,
  RunCommandOptions,
  StartProcessOptions,
  ProcessStatus,
  ProcessHandle,
  Snapshot,
  CreateSnapshotOptions,
  RunloopLaunchParameters,
  VercelSandboxResources,
} from './universal-instance';

/** @deprecated Use {@link Instance} instead. */
export type Sandbox = Instance;

/** @deprecated Use {@link InstanceInfo} instead. */
export type SandboxInfo = InstanceInfo;

/** @deprecated Use {@link InstanceFileSystem} instead. */
export type SandboxFileSystem = InstanceFileSystem;

/** @deprecated Use {@link InstanceResourceOptions} instead. */
export type SandboxResourceOptions = InstanceResourceOptions;

/** @deprecated Use {@link InstanceEgressOptions} instead. */
export type SandboxEgressOptions = InstanceEgressOptions;

/** @deprecated Use {@link InstanceEgressInfo} instead. */
export type SandboxEgressInfo = InstanceEgressInfo;

/** @deprecated Use {@link CreateInstanceOptions} instead. */
export type CreateSandboxOptions = CreateInstanceOptions;
