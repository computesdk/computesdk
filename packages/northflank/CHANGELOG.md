# @computesdk/northflank

## 1.1.13

### Patch Changes

- ef8770f: Docs: update examples to the canonical `compute.instances` API (`Instance*` type names, `instanceId`, `methods.instances`). `compute.sandbox` / `Sandbox*` / `methods.sandbox` remain working deprecated aliases.
- Updated dependencies [ef8770f]
  - @computesdk/provider@2.1.14
  - computesdk@4.1.12

## 1.1.12

### Patch Changes

- aadc200: Rename `compute.sandbox` to `compute.instances` and `Sandbox` to `Instance` across the SDK so the abstraction covers all compute forms (sandbox, VM, baremetal). `kind: 'sandbox' | 'vm' | 'baremetal'` is now a field on `CreateInstanceOptions`, `InstanceInfo`, and provider configs. `compute.sandbox`, `methods.sandbox`, `sandboxId`, and all `Sandbox*` type names remain as deprecated aliases so existing providers and callers keep working unchanged. CLI: `compute sandboxes` is now `compute instances` (`sandboxes`/`sbx` aliases preserved).
- Updated dependencies [aadc200]
  - computesdk@4.1.11
  - @computesdk/provider@2.1.13

## 1.1.11

### Patch Changes

- Updated dependencies [16074f4]
  - @computesdk/provider@2.1.12

## 1.1.10

### Patch Changes

- Updated dependencies [7240d21]
  - computesdk@4.1.10
  - @computesdk/provider@2.1.11

## 1.1.9

### Patch Changes

- Updated dependencies [f1a8578]
  - @computesdk/provider@2.1.10
  - computesdk@4.1.9

## 1.1.8

### Patch Changes

- computesdk@4.1.8
- @computesdk/provider@2.1.9

## 1.1.7

### Patch Changes

- Updated dependencies [7e65fe7]
  - @computesdk/provider@2.1.8
  - computesdk@4.1.7

## 1.1.6

### Patch Changes

- Updated dependencies [0732fed]
  - computesdk@4.1.6
  - @computesdk/provider@2.1.7

## 1.1.5

### Patch Changes

- Updated dependencies [3914faa]
  - computesdk@4.1.5
  - @computesdk/provider@2.1.6

## 1.1.4

### Patch Changes

- Updated dependencies [6ec91ff]
  - @computesdk/provider@2.1.5

## 1.1.3

### Patch Changes

- cfc45de: Add `ephemeralStorageSize` option to configure ephemeral storage per container (in MB). Passes through to `deployment.storage.ephemeralStorage.storageSize` in the Northflank API. Works at both the provider config level and per-sandbox via `create()`.

## 1.1.2

### Patch Changes

- Updated dependencies [f3fe311]
  - computesdk@4.1.4
  - @computesdk/provider@2.1.4

## 1.1.1

### Patch Changes

- 1b5bebf: Reuse TCP/TLS connections by passing a shared keepAlive HTTP(S) agent to the Northflank API client and WebSocket exec upgrade, reducing per-request handshake overhead under high request volume.

## 1.1.0

### Minor Changes

- ab81945: Add the initial Northflank provider package for deploying and managing compute workloads on Northflank's container platform, with sandbox lifecycle support, command execution, and provider docs.

## 1.0.0

### Major Changes

- Initial release of the Northflank provider for ComputeSDK
  - Deploy sandboxes as Northflank deployment services
  - Execute code in Python and Node.js runtimes
  - Run shell commands with cwd, env, and background support
  - Full filesystem operations via exec
  - Get public URLs for exposed ports
