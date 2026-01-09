# @computesdk/docker

## 1.2.11

### Patch Changes

- Updated dependencies [7c8d968]
  - computesdk@1.11.1

## 1.2.10

### Patch Changes

- Updated dependencies [40d66fc]
  - computesdk@1.11.0

## 1.2.9

### Patch Changes

- computesdk@1.10.3

## 1.2.8

### Patch Changes

- Updated dependencies [07e0953]
  - computesdk@1.10.2

## 1.2.7

### Patch Changes

- Updated dependencies [fa18a99]
  - computesdk@1.10.1

## 1.2.6

### Patch Changes

- Updated dependencies [38caad9]
- Updated dependencies [f2d4273]
  - computesdk@1.10.0

## 1.2.5

### Patch Changes

- Updated dependencies [251f324]
  - computesdk@1.9.6

## 1.2.4

### Patch Changes

- Updated dependencies [b027cd9]
  - computesdk@1.9.5

## 1.2.3

### Patch Changes

- computesdk@1.9.4

## 1.2.2

### Patch Changes

- Updated dependencies [f38470d]
- Updated dependencies [f38470d]
  - computesdk@1.9.3

## 1.2.1

### Patch Changes

- Updated dependencies [1ac5ad2]
  - computesdk@1.9.1

## 1.2.0

### Minor Changes

- 8002931: Adding in support for ClientSandbox to all packages

### Patch Changes

- Updated dependencies [8002931]
  - computesdk@1.9.0

## 1.1.8

### Patch Changes

- a146b97: Adding in proper background command via background: true
- Updated dependencies [a146b97]
  - computesdk@1.8.8

## 1.1.7

### Patch Changes

- Updated dependencies [04ffecf]
  - computesdk@1.8.7

## 1.1.6

### Patch Changes

- 51b9259: Adding support for Compute CLI
- Updated dependencies [51b9259]
  - computesdk@1.8.6

## 1.1.5

### Patch Changes

- Updated dependencies [f0eef79]
- Updated dependencies [f0eef79]
- Updated dependencies [f0eef79]
  - computesdk@1.8.5

## 1.1.4

### Patch Changes

- Updated dependencies [11a3b8c]
- Updated dependencies [11a3b8c]
  - computesdk@1.8.4

## 1.1.3

### Patch Changes

- Updated dependencies [483c700]
  - computesdk@1.8.3

## 1.1.2

### Patch Changes

- Updated dependencies [66d50b9]
  - computesdk@1.8.2

## 1.1.1

### Patch Changes

- computesdk@1.8.1

## 1.1.0

### Minor Changes

- 99b807c: Integrating packages w/ @computesdk/client

### Patch Changes

- Updated dependencies [99b807c]
  - computesdk@1.8.0

## 1.0.6

### Patch Changes

- computesdk@1.7.6

## 1.0.5

### Patch Changes

- computesdk@1.7.5

## 1.0.4

### Patch Changes

- computesdk@1.7.4

## 1.0.3

### Patch Changes

- computesdk@1.7.3

## 1.0.2

### Patch Changes

- computesdk@1.7.2

## 1.0.1

### Patch Changes

- computesdk@1.7.1

## 1.0.0

### Major Changes

- Initial release of the **Docker** provider for ComputeSDK.
- Implements core sandbox functionality:

  - **Sandbox lifecycle:** create, reconnect (`getById`), list, destroy — containers labeled with `com.computesdk.sandbox=true`.
  - **Code execution** for **Node.js** and **Python** with explicit runtime selection (`'node' | 'python'`), file-based execution, and clear **syntax-error** surfacing.
  - **Command execution** (foreground & background) with PID capture for background jobs.
  - **Filesystem helpers:** `readFile`, `writeFile`, `mkdir`, `readdir`, `exists`, `remove`.
  - **Port URL resolution:** `getUrl({ port, protocol? })` returns a host-reachable URL for published ports.

- Image & registry support:

  - **Pull policy:** `always | ifNotPresent | never`.
  - Optional **private registry auth** (username/password, identity/bearer tokens).

- Configuration & runtime:

  - Per-sandbox **runtime labeling** (`com.computesdk.runtime=<python|node>`); no auto-detection.
  - Container defaults (workdir, env, binds, ports, network mode, capabilities, resource limits, log driver).
  - **GPU support** via `DeviceRequests` (`gpus: 'all' | number | string`) when NVIDIA runtime is available.

- Stability & DX:

  - **Keep-alive** command to keep containers running for repeated exec/FS operations.
  - Robust stdout/stderr demuxing and improved error messages from Docker.
  - **Typed access** to native `dockerode` client and `Container` via `getInstance()`.
  - Sensible defaults: `python:3.11-slim` / `node:20-alpine`, `/workspace`, optional port bindings, and safe resource caps.
