# @computesdk/cmd

## 0.4.0

### Minor Changes

- 6b0c820: refactor: remove cmd() callable, separate shell wrapping from command building

  **Breaking Change**: The `cmd` export is no longer callable. It's now a pure namespace for command builders.

  **Before:**

  ```typescript
  import { cmd } from "@computesdk/cmd";

  cmd.npm.install(); // Building ✅
  cmd(npm.install(), { cwd }); // Wrapping ❌ NO LONGER WORKS
  ```

  **After:**

  ```typescript
  import { npm, shell } from "@computesdk/cmd";

  npm.install(); // Building ✅
  shell(npm.install(), { cwd }); // Wrapping ✅ Use shell() instead
  ```

  **Better (Recommended):**

  ```typescript
  // Let sandbox handle options
  await sandbox.runCommand("npm install", { cwd: "/app" });
  ```

  **Why:**

  - Separates concerns: building vs. shell wrapping
  - Aligns with modern `runCommand(command, options)` API
  - Removes confusion from dual-purpose export
  - Completes the clean command execution refactor from #192 and #193

  **Migration:**

  - Replace `cmd(command, options)` with `shell(command, options)`
  - Or better: use `sandbox.runCommand(command, options)` directly

## 0.3.1

### Patch Changes

- b027cd9: Updating gateway versioning + install and setup

## 0.3.0

### Minor Changes

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

## 0.2.0

### Minor Changes

- 8002931: Adding in support for ClientSandbox to all packages
