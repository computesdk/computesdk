# @computesdk/deno-sandbox
## 1.0.0

### Major Changes

- Initial public release of the **Deno Sandbox Provider** for ComputeSDK:

  - **Deno Deploy Sandboxes via `@deno/sandbox`**: Create/connect/list/destroy sandboxes backed by Deno Deploy’s sandbox environments
  - **Code Execution**:
    - **JavaScript/TypeScript** executed inside the Deno sandbox runtime (ComputeSDK `"node"` maps to JS-in-Deno)
    - **Python support via Pyodide (WASM)** executed inside the sandbox JS runtime, with stdout/stderr capture
  - **Command Execution**: Run shell commands through the sandbox process APIs with captured stdout/stderr and exit codes
  - **Filesystem Support**: Native sandbox filesystem operations (read/write/mkdir/readdir/exists/remove)

  Features:

  - TypeScript support with full type definitions
  - Provider factory-based implementation consistent with other ComputeSDK providers
  - Works in monorepo builds (tsup) with DTS output
  - Integration tests gated behind `DENO_DEPLOY_TOKEN`

### Patch Changes

- Updated dependencies
  - computesdk@1.0.0
