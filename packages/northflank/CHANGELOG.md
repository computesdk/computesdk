# @computesdk/northflank

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
