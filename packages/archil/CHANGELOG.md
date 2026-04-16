# @computesdk/archil

## 0.2.0

### Minor Changes

- 2b505d5: Add `@computesdk/archil` provider, which executes commands against an Archil
  disk via Archil's control-plane HTTP API.

  The provider maps ComputeSDK sandbox lifecycle to Archil disks:

  - `create()` provisions a new disk
  - `getById()` resolves by disk id (with name fallback)
  - `destroy()` deletes the disk

  Command execution (`runCommand`/`runCode`) and filesystem helpers are executed
  through Archil's disk `exec` endpoint.

### Patch Changes

- 432238c: Improve Archil provider runtime compatibility in integration environments.

  - Ensure `runCommand` sets a default `HOME` value when not present in exec environments.
  - Make `runCode` throw on syntax errors for Node/Python to match provider test-suite expectations.

- Updated dependencies [6a79b9b]
  - computesdk@3.0.0
  - @computesdk/provider@2.0.0
