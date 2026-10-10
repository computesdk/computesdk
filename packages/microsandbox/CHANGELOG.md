# @computesdk/microsandbox

## 0.1.10

### Patch Changes

- 16074f4: Serialize process-global provider credentials with a shared config gate

  Adds `createConfigGate` / `createConfigStamp` to `@computesdk/provider` and applies them to the adapters whose vendor SDKs hold credentials in module-global state: beam (`beamOpts` + singleton client), blaxel (`initialize()` mutates global settings), microsandbox (`setDefaultBackend`), and lightning (refactored from its local gate onto the shared one).

  Same-config operations still run concurrently. A different config waits for the active operations to drain, then installs itself once — so two API keys on one process can no longer clobber each other mid-request. Created and connected sandboxes are stamped with their config so instance operations (runCommand, filesystem, getUrl) re-enter the gate under their originating credentials.

  For `@computesdk/microsandbox` this replaces the one-backend-per-process pin that threw "Microsandbox supports one backend configuration per process": distinct explicit selections now serialize instead of failing.

- Updated dependencies [16074f4]
  - @computesdk/provider@2.1.12

## 0.1.9

### Patch Changes

- Updated dependencies [7240d21]
  - computesdk@4.1.10
  - @computesdk/provider@2.1.11

## 0.1.8

### Patch Changes

- Updated dependencies [f1a8578]
  - @computesdk/provider@2.1.10
  - computesdk@4.1.9

## 0.1.7

### Patch Changes

- computesdk@4.1.8
- @computesdk/provider@2.1.9

## 0.1.6

### Patch Changes

- Updated dependencies [7e65fe7]
  - @computesdk/provider@2.1.8
  - computesdk@4.1.7

## 0.1.5

### Patch Changes

- 4f2394e: Remove backend serialization for concurrent operations using one backend configuration per process, rejecting conflicting configurations before changing the SDK backend. Accept memoryMib and rootDiskMib in sandbox create options so requested resources are not silently replaced by defaults. Retry sandbox shutdown and deletion, and report failed cleanup of cancelled sandbox creation. Require Microsandbox SDK 0.6.18 or newer within the 0.6 release line. Default to ephemeral sandboxes with a 15-minute idle timeout; support explicit persistent and idle timeout overrides.

## 0.1.4

### Patch Changes

- Updated dependencies [0732fed]
  - computesdk@4.1.6
  - @computesdk/provider@2.1.7

## 0.1.3

### Patch Changes

- Updated dependencies [3914faa]
  - computesdk@4.1.5
  - @computesdk/provider@2.1.6

## 0.1.2

### Patch Changes

- 42a5158: Update microsandbox to 0.6.12 so the provider works on Linux systems with glibc 2.28 and newer.

## 0.1.1

### Patch Changes

- 183f0f1: Add a microsandbox provider with local and cloud backends, native command streaming, filesystem access, and local port and snapshot support.
