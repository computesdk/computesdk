# @computesdk/docker

## 1.2.45

### Patch Changes

- Updated dependencies [aa4ca58]
  - computesdk@4.0.0
  - @computesdk/provider@2.0.0

## 1.2.44

### Patch Changes

- Updated dependencies [3ef4817]
- Updated dependencies [371f667]
  - @computesdk/provider@1.4.0
  - computesdk@3.0.0

## 1.2.43

### Patch Changes

- Updated dependencies [a321f01]
  - computesdk@2.6.0
  - @computesdk/provider@1.3.0

## 1.2.42

### Patch Changes

- 7c53d28: Add `buildShellCommand` utility to unify shell command building across providers

  Centralizes cwd/env handling into a single `buildShellCommand` function in
  `@computesdk/provider`, fixing bugs where env vars didn't work with cwd set
  (docker, sprites, hopx) and where values weren't properly quoted (namespace,
  sprites, hopx). All shell-based providers now use the shared utility.

- Updated dependencies [7c53d28]
  - @computesdk/provider@1.2.0

## 1.2.41

### Patch Changes

- 9c9521f: Fix build failures and improve container lifecycle:

  - Add missing `@computesdk/provider` dependency (was imported but never declared in package.json)
  - Fix `runCommand` signature to accept `RunCommandOptions` instead of `string[]`
  - Use `exec sleep infinity` for keepalive so PID 1 handles signals
  - Replace slow `stop + force remove` with instant `kill + remove`

## 1.2.40

### Patch Changes

- Updated dependencies [3e6a91a]
  - computesdk@2.5.4

## 1.2.40

### Patch Changes

- Updated dependencies [9a312d2]
  - computesdk@2.5.4

## 1.2.40

### Patch Changes

- Updated dependencies [b34d97f]
  - computesdk@2.5.4

## 1.2.39

### Patch Changes

- Updated dependencies [45f918b]
  - computesdk@2.5.3

## 1.2.39

### Patch Changes

- Updated dependencies [0b97465]
  - computesdk@2.5.3

## 1.2.38

### Patch Changes

- Updated dependencies [5f1b08f]
  - computesdk@2.5.2

## 1.2.35

### Patch Changes

- Updated dependencies [3c4e595]
  - computesdk@2.4.0

## 1.2.34

### Patch Changes

- Updated dependencies [d49d036]
  - computesdk@2.3.0

## 1.2.33

### Patch Changes

- Updated dependencies [5b010a3]
  - computesdk@2.2.1

## 1.2.32

### Patch Changes

- Updated dependencies [55b793e]
  - computesdk@2.2.0

## 1.2.31

### Patch Changes

- Updated dependencies [a5a7f63]
  - computesdk@2.1.2

## 1.2.30

### Patch Changes

- Updated dependencies [2c9468b]
  - computesdk@2.1.1

## 1.2.29

### Patch Changes

- Updated dependencies [9e7e50a]
  - computesdk@2.1.0

## 1.2.28

### Patch Changes

- Updated dependencies [e3ed89b]
  - computesdk@2.0.2

## 1.2.27

### Patch Changes

- ca82472: Bump versions to skip burned version numbers from rollback.

## 1.2.26

### Patch Changes

- Updated dependencies [53506ed]
  - computesdk@2.0.1

## 1.2.25

### Patch Changes

- Updated dependencies [9946e72]
  - computesdk@1.21.1

## 1.2.24

### Patch Changes

- Updated dependencies [7ba17e1]
  - computesdk@1.21.0

## 1.2.23

### Patch Changes

- Updated dependencies [2b30125]
- Updated dependencies [2b30125]
  - computesdk@1.20.0

## 1.2.22

### Patch Changes

- Updated dependencies [68b5296]
  - computesdk@1.19.0

## 1.2.21

### Patch Changes

- Updated dependencies [59147ac]
  - computesdk@1.18.2

## 1.2.20

### Patch Changes

- Updated dependencies [688ca54]
- Updated dependencies [688ca54]
  - computesdk@1.18.1

## 1.2.19

### Patch Changes

- Updated dependencies [128edac]
  - computesdk@1.18.0

## 1.2.18

### Patch Changes

- Updated dependencies [79c9fc5]
  - computesdk@1.17.0

## 1.2.17

### Patch Changes

- Updated dependencies [208a400]
  - computesdk@1.16.0

## 1.2.16

### Patch Changes

- Updated dependencies [25341eb]
  - computesdk@1.15.0

## 1.2.15

### Patch Changes

- Updated dependencies [0c58ba9]
  - computesdk@1.14.0

## 1.2.14

### Patch Changes

- Updated dependencies [3333388]
  - computesdk@1.13.0

## 1.2.13

### Patch Changes

- Updated dependencies [4decff7]
  - computesdk@1.12.1

## 1.2.12

### Patch Changes

- Updated dependencies [fdda069]
  - computesdk@1.12.0

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
