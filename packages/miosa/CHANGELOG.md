# @computesdk/miosa

## 1.1.0

### Minor Changes

- fce7442: Route create/exec/destroy through `@miosa/sdk`'s SOMA one-hop runner transport (`run-<region>.miosa.ai`) instead of the control plane, for callers that opt in explicitly via `runnerMode`/`MIOSA_RUNNER_MODE` (no API key carries a region yet, so there is no key-based eligibility). Every other operation - list, getById, getInfo, getUrl/expose, filesystem, snapshots - keeps using the existing control-plane transport unchanged. Not released until `@miosa/sdk` publishes a version containing `RunnerClient`.

### Patch Changes

- fce7442: Dispatch each request to the least-loaded ready HTTP/2 session, honoring that session's own advertised concurrent-stream limit, instead of rotating blindly across every ready session. A burst now spreads across sessions as they come online rather than piling onto whichever session connected first, and only waits when every ready session is already at its own stream cap.

## 1.0.10

### Patch Changes

- Updated dependencies [7240d21]
  - computesdk@4.1.10
  - @computesdk/provider@2.1.11

## 1.0.9

### Patch Changes

- Updated dependencies [f1a8578]
  - @computesdk/provider@2.1.10
  - computesdk@4.1.9

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
