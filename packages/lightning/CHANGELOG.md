# @computesdk/lightning

## 1.0.13

### Patch Changes

- Updated dependencies [d7d8efc]
- Updated dependencies [1b639da]
  - computesdk@4.1.13
  - @computesdk/provider@2.1.15

## 1.0.12

### Patch Changes

- ef8770f: Docs: update examples to the canonical `compute.instances` API (`Instance*` type names, `instanceId`, `methods.instances`). `compute.sandbox` / `Sandbox*` / `methods.sandbox` remain working deprecated aliases.
- Updated dependencies [ef8770f]
  - @computesdk/provider@2.1.14
  - computesdk@4.1.12

## 1.0.11

### Patch Changes

- aadc200: Rename `compute.sandbox` to `compute.instances` and `Sandbox` to `Instance` across the SDK so the abstraction covers all compute forms (sandbox, VM, baremetal). `kind: 'sandbox' | 'vm' | 'baremetal'` is now a field on `CreateInstanceOptions`, `InstanceInfo`, and provider configs. `compute.sandbox`, `methods.sandbox`, `sandboxId`, and all `Sandbox*` type names remain as deprecated aliases so existing providers and callers keep working unchanged. CLI: `compute sandboxes` is now `compute instances` (`sandboxes`/`sbx` aliases preserved).
- Updated dependencies [aadc200]
  - computesdk@4.1.11
  - @computesdk/provider@2.1.13

## 1.0.10

### Patch Changes

- 16074f4: Serialize process-global provider credentials with a shared config gate

  Adds `createConfigGate` / `createConfigStamp` to `@computesdk/provider` and applies them to the adapters whose vendor SDKs hold credentials in module-global state: beam (`beamOpts` + singleton client), blaxel (`initialize()` mutates global settings), microsandbox (`setDefaultBackend`), and lightning (refactored from its local gate onto the shared one).

  Same-config operations still run concurrently. A different config waits for the active operations to drain, then installs itself once — so two API keys on one process can no longer clobber each other mid-request. Created and connected sandboxes are stamped with their config so instance operations (runCommand, filesystem, getUrl) re-enter the gate under their originating credentials.

  For `@computesdk/microsandbox` this replaces the one-backend-per-process pin that threw "Microsandbox supports one backend configuration per process": distinct explicit selections now serialize instead of failing.

- Updated dependencies [16074f4]
  - @computesdk/provider@2.1.12

## 1.0.9

### Patch Changes

- Updated dependencies [7240d21]
  - computesdk@4.1.10
  - @computesdk/provider@2.1.11

## 1.0.8

### Patch Changes

- Updated dependencies [f1a8578]
  - @computesdk/provider@2.1.10
  - computesdk@4.1.9

## 1.0.7

### Patch Changes

- computesdk@4.1.8
- @computesdk/provider@2.1.9

## 1.0.6

### Patch Changes

- Updated dependencies [7e65fe7]
  - @computesdk/provider@2.1.8
  - computesdk@4.1.7

## 1.0.5

### Patch Changes

- Updated dependencies [0732fed]
  - computesdk@4.1.6
  - @computesdk/provider@2.1.7

## 1.0.4

### Patch Changes

- Updated dependencies [3914faa]
  - computesdk@4.1.5
  - @computesdk/provider@2.1.6

## 1.0.3

### Patch Changes

- Updated dependencies [6ec91ff]
  - @computesdk/provider@2.1.5

## 1.0.2

### Patch Changes

- Updated dependencies [f3fe311]
  - computesdk@4.1.4
  - @computesdk/provider@2.1.4

## 1.0.1

### Patch Changes

- 8079ecc: Add Lightning AI provider
