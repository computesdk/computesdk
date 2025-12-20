# @computesdk/workbench

## 2.0.0

### Patch Changes

- 729c9b1: Add compute.isSetup() command to check daemon status

  Added `compute.isSetup()` command to check if the ComputeSDK daemon is installed and running, enabling conditional setup workflows.

  **New Command:**

  - `compute.isSetup()` - Returns exit 0 if daemon is ready, exit 1 if setup needed
  - Accepts optional `host` and `port` parameters for remote daemon checks

  **Enhanced:**

  - `compute.health()` now accepts `host` and `port` parameters (default: localhost:18080)

  **Bug Fix:**

  - Fixed default port from 3030 to 18080 across all compute commands

  **Usage:**

  ```javascript
  const result = await sandbox.runCommand(compute.isSetup());
  if (result.exitCode === 0) {
    console.log("Daemon is ready!");
  } else {
    await sandbox.runCommand(compute.setup({ apiKey: "key" }));
  }
  ```

- Updated dependencies [729c9b1]
- Updated dependencies [64569f1]
  - @computesdk/cmd@0.3.0
  - @computesdk/modal@1.7.0
  - computesdk@1.9.4
  - @computesdk/blaxel@1.3.3
  - @computesdk/cloudflare@1.3.3
  - @computesdk/codesandbox@1.5.3
  - @computesdk/daytona@1.6.3
  - @computesdk/e2b@1.7.3
  - @computesdk/railway@1.1.3
  - @computesdk/runloop@1.3.3
  - @computesdk/vercel@1.6.3

## 1.0.2

### Patch Changes

- Updated dependencies [f38470d]
- Updated dependencies [f38470d]
  - computesdk@1.9.3
  - @computesdk/blaxel@1.3.2
  - @computesdk/cloudflare@1.3.2
  - @computesdk/codesandbox@1.5.2
  - @computesdk/daytona@1.6.2
  - @computesdk/e2b@1.7.2
  - @computesdk/modal@1.6.2
  - @computesdk/railway@1.1.2
  - @computesdk/runloop@1.3.2
  - @computesdk/vercel@1.6.2

## 1.0.1

### Patch Changes

- Updated dependencies [1ac5ad2]
  - computesdk@1.9.1
  - @computesdk/blaxel@1.3.1
  - @computesdk/cloudflare@1.3.1
  - @computesdk/codesandbox@1.5.1
  - @computesdk/daytona@1.6.1
  - @computesdk/e2b@1.7.1
  - @computesdk/modal@1.6.1
  - @computesdk/railway@1.1.1
  - @computesdk/runloop@1.3.1
  - @computesdk/vercel@1.6.1

## 1.0.0

### Patch Changes

- Updated dependencies [8002931]
  - computesdk@1.9.0
  - @computesdk/daytona@1.6.0
  - @computesdk/cmd@0.2.0
  - @computesdk/e2b@1.7.0
  - @computesdk/blaxel@1.3.0
  - @computesdk/cloudflare@1.3.0
  - @computesdk/codesandbox@1.5.0
  - @computesdk/modal@1.6.0
  - @computesdk/railway@1.1.0
  - @computesdk/runloop@1.3.0
  - @computesdk/vercel@1.6.0
