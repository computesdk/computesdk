# @computesdk/docker

## 1.0.0

### Major Changes

* Initial release of the **Docker** provider for ComputeSDK.
* Implements core sandbox functionality:

  * **Sandbox lifecycle:** create, reconnect (`getById`), list, destroy — containers labeled with `com.computesdk.sandbox=true`.
  * **Code execution** for **Node.js** and **Python** with explicit runtime selection (`'node' | 'python'`), file-based execution, and clear **syntax-error** surfacing.
  * **Command execution** (foreground & background) with PID capture for background jobs.
  * **Filesystem helpers:** `readFile`, `writeFile`, `mkdir`, `readdir`, `exists`, `remove`.
  * **Port URL resolution:** `getUrl({ port, protocol? })` returns a host-reachable URL for published ports.
* Image & registry support:

  * **Pull policy:** `always | ifNotPresent | never`.
  * Optional **private registry auth** (username/password, identity/bearer tokens).
* Configuration & runtime:

  * Per-sandbox **runtime labeling** (`com.computesdk.runtime=<python|node>`); no auto-detection.
  * Container defaults (workdir, env, binds, ports, network mode, capabilities, resource limits, log driver).
  * **GPU support** via `DeviceRequests` (`gpus: 'all' | number | string`) when NVIDIA runtime is available.
* Stability & DX:

  * **Keep-alive** command to keep containers running for repeated exec/FS operations.
  * Robust stdout/stderr demuxing and improved error messages from Docker.
  * **Typed access** to native `dockerode` client and `Container` via `getInstance()`.
  * Sensible defaults: `python:3.11-slim` / `node:20-alpine`, `/workspace`, optional port bindings, and safe resource caps.
