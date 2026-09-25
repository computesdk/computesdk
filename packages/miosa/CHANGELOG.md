# @computesdk/miosa

## 1.0.8

### Patch Changes

- computesdk@4.1.8
- @computesdk/provider@2.1.9

## 1.0.7

### Patch Changes

- Updated dependencies [7e65fe7]
  - @computesdk/provider@2.1.8
  - computesdk@4.1.7

## 1.0.6

### Patch Changes

- Updated dependencies [0732fed]
  - computesdk@4.1.6
  - @computesdk/provider@2.1.7

## 1.0.5

### Patch Changes

- Updated dependencies [3914faa]
  - computesdk@4.1.5
  - @computesdk/provider@2.1.6

## 1.0.4

### Patch Changes

- e767260: Route MIOSA sandbox requests over ready HTTP/2 sessions, with a quorum-based cold-start gate. The provider now tracks connected sessions and dispatches only onto warm connections; on a cold pool it waits for the first session to connect and up to 250 ms for a quorum of 8, improving burst median TTI. The wait is bounded by a 1 second deadline and re-armed when the pool is fully recycled, preventing hangs and stale gates.

## 1.0.3

### Patch Changes

- d7a0e73: Implement snapshot deletion: resolve the owning sandbox from an in-process index populated by create/list, falling back to scanning the caller's sandboxes; idempotent on unknown or already-deleted snapshots

## 1.0.2

### Patch Changes

- 87c6f00: Map ComputeSDK resource hints (vcpus/memory) onto MIOSA size contracts

## 1.0.1

### Patch Changes

- 4db3c80: Add the MIOSA Firecracker microVM sandbox provider.
