# @computesdk/archil

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
