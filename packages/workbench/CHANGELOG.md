# @computesdk/workbench

## 3.1.0

### Minor Changes

- f2d4273: Add named sandbox support, extend timeout functionality, and child sandbox REPL access

  ## Named Sandboxes

  Sandboxes can now be referenced by stable (namespace, name) identifiers instead of just provider-generated UUIDs.

  **New Methods:**

  - `compute.sandbox.findOrCreate({ name, namespace?, timeout? })` - Find existing or create new sandbox by (namespace, name)
  - `compute.sandbox.find({ name, namespace? })` - Find existing sandbox without creating

  **Example:**

  ```typescript
  // First call - creates new sandbox
  const sandbox1 = await compute.sandbox.findOrCreate({
    name: "my-app",
    namespace: "user-123",
  });

  // Later call - returns same sandbox
  const sandbox2 = await compute.sandbox.findOrCreate({
    name: "my-app",
    namespace: "user-123",
  });
  // sandbox1.sandboxId === sandbox2.sandboxId
  ```

  **Features:**

  - Namespace-based isolation (different namespaces = different sandboxes)
  - Default namespace of "default" when not specified
  - Automatic stale mapping cleanup
  - Works with gateway provider

  ## Extend Timeout

  You can now extend the timeout/expiration of an existing sandbox to keep it alive longer:

  **New Method:**

  - `compute.sandbox.extendTimeout(sandboxId, options?)` - Extend sandbox timeout

  **Example:**

  ```typescript
  // Extend timeout by default 15 minutes
  await compute.sandbox.extendTimeout("sandbox-123");

  // Extend timeout by custom duration (30 minutes)
  await compute.sandbox.extendTimeout("sandbox-123", {
    duration: 30 * 60 * 1000,
  });

  // Useful with named sandboxes
  const sandbox = await compute.sandbox.findOrCreate({
    name: "long-running-task",
    namespace: "user-alice",
  });

  // Extend timeout before it expires
  await compute.sandbox.extendTimeout(sandbox.sandboxId, {
    duration: 60 * 60 * 1000, // 1 hour
  });
  ```

  **Features:**

  - Default extension duration is 15 minutes (900000ms)
  - Only available with gateway provider
  - Gateway endpoint: `POST /v1/sandbox/:id/extend`

  ## Named Sandboxes in Workbench

  The workbench REPL now supports creating and managing named sandboxes:

  **New REPL Methods:**

  - `create({ name?, namespace?, ...options })` - Create sandbox with optional name/namespace
  - `findOrCreate({ name, namespace?, ...options })` - Find or create named sandbox
  - `find({ name, namespace? })` - Find existing named sandbox

  **Example (in workbench REPL):**

  ```javascript
  // Create sandbox with name and namespace (no await needed)
  const sandbox = create({ name: "my-app", namespace: "user-123" });

  // Find or create named sandbox
  const sandbox = findOrCreate({ name: "my-app", namespace: "user-123" });

  // Find existing sandbox
  const existing = find({ name: "my-app", namespace: "user-123" });
  ```

  **Features:**

  - Gateway mode only (use `mode gateway` to enable)
  - Promises are auto-awaited (no need for `await` keyword)
  - Auto-completion support
  - Documented in help command

  ## Child Sandboxes in Workbench

  The workbench REPL now exposes child sandbox operations:

  **New REPL Methods:**

  - `child.create()` - Create a child sandbox
  - `child.list()` - List all child sandboxes
  - `child.retrieve(subdomain)` - Get info about a specific child
  - `child.destroy(subdomain, options?)` - Delete a child sandbox

  **Example (in workbench REPL):**

  ```javascript
  // Create a child sandbox (no await needed - promises are auto-awaited)
  const child = child.create();
  console.log(child.url); // https://sandbox-12345.sandbox.computesdk.com

  // List all children
  const children = child.list();

  // Delete a child
  child.destroy("sandbox-12345", { deleteFiles: true });
  ```

  **Features:**

  - Gateway mode only (use `mode gateway` to enable)
  - Works similar to `filesystem` namespace in REPL
  - Promises are auto-awaited (no need for `await` keyword)
  - Auto-completion support
  - Documented in help command

### Patch Changes

- Updated dependencies [38caad9]
- Updated dependencies [f2d4273]
  - computesdk@1.10.0
  - @computesdk/blaxel@1.3.6
  - @computesdk/cloudflare@1.3.6
  - @computesdk/codesandbox@1.5.6
  - @computesdk/daytona@1.6.6
  - @computesdk/e2b@1.7.6
  - @computesdk/modal@1.8.1
  - @computesdk/railway@1.1.6
  - @computesdk/runloop@1.3.6
  - @computesdk/vercel@1.6.6

## 3.0.0

### Patch Changes

- Updated dependencies [13bb329]
  - @computesdk/modal@1.8.0

## 2.0.2

### Patch Changes

- Updated dependencies [251f324]
  - computesdk@1.9.6
  - @computesdk/blaxel@1.3.5
  - @computesdk/cloudflare@1.3.5
  - @computesdk/codesandbox@1.5.5
  - @computesdk/daytona@1.6.5
  - @computesdk/e2b@1.7.5
  - @computesdk/modal@1.7.2
  - @computesdk/railway@1.1.5
  - @computesdk/runloop@1.3.5
  - @computesdk/vercel@1.6.5

## 2.0.1

### Patch Changes

- Updated dependencies [b027cd9]
  - computesdk@1.9.5
  - @computesdk/cmd@0.3.1
  - @computesdk/blaxel@1.3.4
  - @computesdk/cloudflare@1.3.4
  - @computesdk/codesandbox@1.5.4
  - @computesdk/daytona@1.6.4
  - @computesdk/e2b@1.7.4
  - @computesdk/modal@1.7.1
  - @computesdk/railway@1.1.4
  - @computesdk/runloop@1.3.4
  - @computesdk/vercel@1.6.4

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
