# @computesdk/archil

## 0.4.16

### Patch Changes

- ecde591: Fix snapshot handling in the Blaxel, Archil, and Namespace providers

  - `@computesdk/blaxel`: `sandbox.create({ snapshotId })` now forks a new
    sandbox from the workspace snapshot via `Snapshot.get(id).fork(...)`
    instead of treating the id as a live sandbox (`sandboxId` still resumes a
    live sandbox). The snapshot manager now maps to Blaxel's real snapshot
    resources (`Snapshot.create/list/delete`, `sandbox.snapshots`) instead of
    treating sandbox instances as snapshots.
  - `@computesdk/archil`: `sandbox.create({ snapshotId })` forks a new sandbox
    from the source sandbox via `POST /api/sandboxes/{id}/fork` (persistent
    mode); `sandboxId` attaches to a live sandbox or disk. Added a snapshot
    manager where `create` forks the source sandbox and `delete` removes the
    backing sandbox (snapshot listing is unsupported — Archil has no snapshot
    resource).
  - `@computesdk/namespace`: `sandbox.create({ snapshotId })` restores
    filesystem state by attaching a new PERSISTENT volume seeded via
    `VolumeRequest.from_snapshot_id` (mounted at `/computesdk-data`). Added a
    snapshot manager over the `StorageService` API: `list` enumerates
    persistent-volume snapshots and `delete` abandons one. `create` throws —
    Namespace snapshots are captured automatically on instance shutdown, never
    on demand.

## 0.4.15

### Patch Changes

- computesdk@4.1.8
- @computesdk/provider@2.1.9

## 0.4.14

### Patch Changes

- Updated dependencies [7e65fe7]
  - @computesdk/provider@2.1.8
  - computesdk@4.1.7

## 0.4.13

### Patch Changes

- 0732fed: Add `execution: "persistent"` mode to the Archil provider: `create` provisions a
  persistent Archil sandbox VM (waited to `running`), `runCommand` uses the
  sandbox's interactive process API over a short-lived WebSocket connection
  (fresh connection URL per command), `getById` auto-resumes paused sandboxes,
  `destroy` deletes the sandbox, and `getUrl` resolves published endpoints.
  Default `execution: "exec"` behavior is unchanged.

  Also adds `ephemeral?: boolean` to the shared `CreateSandboxOptions` as the
  standard flag for providers with both ephemeral and persistent compute
  surfaces, and wires it through every dual-mode provider:

  - Archil: `ephemeral: true` -> exec-mode disk handle, `false` -> persistent VM.
  - Upstash: `ephemeral` -> `EphemeralBox`/`Box` (unchanged semantics, now typed).
  - Cloud Run: `ephemeral` overrides configured `executionMode` per sandbox
    (`true` -> `ephemeral`, `false` -> `stateful`).
  - Freestyle: `ephemeral` overrides configured `persistent` per sandbox
    (`true` -> deleted on stop, `false` -> kept).

- Updated dependencies [0732fed]
  - computesdk@4.1.6
  - @computesdk/provider@2.1.7

## 0.4.12

### Patch Changes

- Updated dependencies [3914faa]
  - computesdk@4.1.5
  - @computesdk/provider@2.1.6

## 0.4.11

### Patch Changes

- 4e6aec8: feat(archil): use the official `disk` client instead of hand-rolled fetch calls

  Replaces the provider's bespoke `callApi` helper with Archil's official `disk`
  package (`^1.1.2`), so auth headers, response envelopes, and endpoint paths are
  maintained upstream rather than duplicated here.

## 0.4.10

### Patch Changes

- 3a3cfa7: Support large filesystem reads, chunk large writes, and reject writes to directory paths.

## 0.4.9

### Patch Changes

- 0f3660c: perf(archil): skip disk lookup on create

  `provider.sandbox.create()` no longer fetches the disk before returning, and `getInfo()` derives metadata from the disk handle when full disk metadata is not available.

## 0.4.8

### Patch Changes

- Updated dependencies [6ec91ff]
  - @computesdk/provider@2.1.5

## 0.4.7

### Patch Changes

- Updated dependencies [f3fe311]
  - computesdk@4.1.4
  - @computesdk/provider@2.1.4

## 0.4.6

### Patch Changes

- Updated dependencies [607a11b]
  - computesdk@4.1.3
  - @computesdk/provider@2.1.3

## 0.4.5

### Patch Changes

- computesdk@4.1.2
- @computesdk/provider@2.1.2

## 0.4.4

### Patch Changes

- Updated dependencies [eca5ec2]
  - computesdk@4.1.1
  - @computesdk/provider@2.1.1

## 0.4.3

### Patch Changes

- Updated dependencies [cc79d78]
  - computesdk@4.1.0
  - @computesdk/provider@2.1.0

## 0.4.2

### Patch Changes

- Updated dependencies [aa4ca58]
  - computesdk@4.0.0
  - @computesdk/provider@2.0.0

## 0.4.1

### Patch Changes

- Updated dependencies [3ef4817]
- Updated dependencies [371f667]
  - @computesdk/provider@1.4.0
  - computesdk@3.0.0

## 0.4.0

### Minor Changes

- f5e369c: Refine Archil sandbox API to strict disk-id semantics.

  - `create()` now requires a top-level `diskId` option (no metadata wrapper).
  - `getById()` now resolves strictly by disk id (no name fallback).
  - Docs/tests updated to match the stricter Archil contract.

## 0.3.0

### Minor Changes

- 9193e8c: Refine Archil sandbox lookup semantics to be ID-only.

  - `create()` now requires an existing disk id in `metadata.diskId` and no longer provisions/deletes disks.
  - `getById()` now resolves disks strictly by disk ID.
  - Removed fallback behavior that treated `getById()` input as a disk name.
  - Updated docs and tests to reflect the stricter contract.

## 0.2.0

### Minor Changes

- a321f01: Add `@computesdk/archil` provider, which executes commands against an Archil
  disk via Archil's control-plane HTTP API.

  The provider maps ComputeSDK sandbox lifecycle to Archil disks:

  - `create()` provisions a new disk
  - `getById()` resolves by disk id (with name fallback)
  - `destroy()` deletes the disk

  Command execution (`runCommand`/`runCode`) and filesystem helpers are executed
  through Archil's disk `exec` endpoint.

### Patch Changes

- a321f01: Improve Archil provider runtime compatibility in integration environments.

  - Ensure `runCommand` sets a default `HOME` value when not present in exec environments.
  - Make `runCode` throw on syntax errors for Node/Python to match provider test-suite expectations.

- Updated dependencies [a321f01]
  - computesdk@2.6.0
  - @computesdk/provider@1.3.0
