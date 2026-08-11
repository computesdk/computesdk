# @computesdk/northflank

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
