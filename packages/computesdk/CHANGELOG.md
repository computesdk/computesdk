# computesdk

## 2.1.2

### Patch Changes

- a5a7f63: Fix edge gateway timeout by sending X-Request-Timeout header and add timeout option to runCommand()

## 2.1.1

### Patch Changes

- 2c9468b: Fix ready() method to pass through the healthy property from the API response

## 2.1.0

### Minor Changes

- 9e7e50a: update gateway headers for codesandbox auth

## 2.0.2

### Patch Changes

- e3ed89b: feat(sdk): add support for smart overlay strategy

## 2.0.1

### Patch Changes

- 53506ed: Introducing ComputeSDK 2.0 with the Sandbox Gateway.

  The Gateway allows you to use the same SDK with ANY provider—including your existing cloud infrastructure—by simply bringing your own keys. Change providers by updating environment variables, not code.

  **Supported Providers (8):** E2B, Modal, Railway, Vercel, Daytona, Render, Blaxel, and Namespace.

  **New Features:**

  - **Namespaces**: Organize sandboxes by user, project, or entity. Combined with named sandboxes, enables idempotent creation via `compute.sandbox.findOrCreate()`.

  - **Servers**: Supervised processes with full lifecycle management:

    - `install` command that runs before `start` (e.g., `npm install`)
    - Restart policies: `never`, `on-failure`, `always`
    - Health checks for readiness detection
    - Graceful shutdown with SIGTERM/SIGKILL handling

  - **Overlays**: Instantly bootstrap sandboxes from template directories:

    - `smart` strategy uses symlinks for instant setup
    - Background copying for heavy directories
    - `waitForCompletion` option to block until ready

  - **Client-Side Access**: Delegate sandbox access to browser clients securely:

    - Session tokens for scoped credentials
    - Magic links for one-click browser authentication

  - **File Watchers**: Real-time filesystem change events via WebSocket

  - **Signal Service**: Port detection and error events for dev server workflows

  - **Environment Management**: First-class `.env` file operations

## 2.0.0

### Major Changes

- Introducing the **Sandbox Gateway** as a first-class citizen in ComputeSDK v2.

  The Gateway allows you to use the same SDK with ANY provider—including your existing cloud infrastructure—by simply bringing your own keys. Change providers by updating environment variables, not code.

  **Supported Providers (8):** E2B, Modal, Railway, Vercel, Daytona, Render, Blaxel, and Namespace.

### New Features

- **Namespaces**: Organize sandboxes by user, project, or entity. Combined with named sandboxes, enables idempotent creation via `compute.sandbox.findOrCreate()`.

- **Servers**: Supervised processes with full lifecycle management:

  - `install` command that runs before `start` (e.g., `npm install`)
  - Restart policies: `never`, `on-failure`, `always`
  - Health checks for readiness detection
  - Graceful shutdown with SIGTERM/SIGKILL handling

- **Overlays**: Instantly bootstrap sandboxes from template directories:

  - `smart` strategy uses symlinks for instant setup
  - Background copying for heavy directories
  - `waitForCompletion` option to block until ready

- **Client-Side Access**: Delegate sandbox access to browser clients securely:

  - Session tokens for scoped credentials
  - Magic links for one-click browser authentication

- **File Watchers**: Real-time filesystem change events via WebSocket

- **Signal Service**: Port detection and error events for dev server workflows

- **Environment Management**: First-class `.env` file operations

## 1.21.1

### Patch Changes

- 9946e72: Add server health check support

  - Add `health_check` configuration option to `ServerStartOptions` and `SandboxServerConfig`
  - Add `HealthCheckConfig` interface with `path`, `interval_ms`, `timeout_ms`, and `delay_ms` options
  - Add `healthy` and `health_status` fields to `ServerInfo` response
  - Add `healthy` field to `ReadyResponse` for overall health status
  - Add `healthy` and `health_check` fields to `SandboxServerInfo` in ready response

## 1.21.0

### Minor Changes

- 7ba17e1: Add configurable gateway request timeouts for compute API calls.

## 1.20.0

### Minor Changes

- 2b30125: Add readiness support, setup payload helpers, and setup-aware sandbox creation options.
- 2b30125: Add readiness support, setup payload helpers, and expanded sandbox/server creation options.

## 1.19.0

### Minor Changes

- 68b5296: Add readiness support, setup payload helpers, and expanded sandbox/server creation options.

## 1.18.2

### Patch Changes

- 59147ac: Add `snapshotId` to ComputeSDK sandbox create options for provider-specific snapshot creation.

## 1.18.1

### Patch Changes

- 688ca54: Fix `sandbox.terminal.retrieve(id)` to return a writable `TerminalInstance` instead of a static `TerminalResponse`.
- 688ca54: feat(sdk): add support for smart overlay strategy

## 1.18.0

### Minor Changes

- 128edac: refactor render package for gateway

## 1.17.0

### Minor Changes

- 79c9fc5: update websockets in setConfig and GatewayConfig

## 1.16.0

### Minor Changes

- 208a400: Add waitForCompletion support for overlay and background commands

  - `overlay.create({ waitForCompletion: true })` - blocks until background copy is done
  - `overlay.waitForCompletion(id)` - wait for an existing overlay's copy to complete
  - `run.command('cmd', { background: true, waitForCompletion: true })` - wait for background command
  - `run.waitForCompletion(terminalId, cmdId)` - wait for background command manually
  - Background command results now include `cmdId` and `terminalId` for manual tracking

## 1.15.0

### Minor Changes

- 25341eb: Breaking: Update SDK types to match server-core PR #95 API changes

  **Server API Changes:**

  - Rename `command` field to `start` in `ServerStartOptions` and `ServerInfo`
  - Add `install` optional field for install commands that run before start (e.g., "npm install")
  - Add `installing` status to `ServerStatus` type

  **Overlay API Changes:**

  - Rename `symlinkedFiles`/`symlinkedDirs` to `copiedFiles`/`copiedDirs` in `OverlayStats`
  - Add `ignore` option to `CreateOverlayOptions` for glob patterns to exclude (e.g., `["node_modules", "*.log"]`)
  - Update documentation to reflect direct file copying instead of symlinking

  Migration:

  ```typescript
  // Before
  await sandbox.server.start({ slug: "api", command: "npm run dev" });
  console.log(server.command);

  // After
  await sandbox.server.start({ slug: "api", start: "npm run dev" });
  // Or with install:
  await sandbox.server.start({
    slug: "api",
    install: "npm install",
    start: "npm run dev",
  });
  console.log(server.start);

  // Overlay stats
  console.log(overlay.stats.copiedFiles); // was: symlinkedFiles
  console.log(overlay.stats.copiedDirs); // was: symlinkedDirs
  ```

## 1.14.0

### Minor Changes

- 0c58ba9: Add server logs API for retrieving captured output from managed servers

  - Add `sandbox.server.logs(slug)` to retrieve combined stdout/stderr logs
  - Add `sandbox.server.logs(slug, { stream: 'stdout' })` to get only stdout
  - Add `sandbox.server.logs(slug, { stream: 'stderr' })` to get only stderr
  - Returns `ServerLogsInfo` with slug, stream type, and logs content

## 1.13.0

### Minor Changes

- 3333388: Add filesystem overlay API for instant sandbox setup from template directories

  - Add `sandbox.filesystem.overlay.create({ source, target })` to create overlays
  - Add `sandbox.filesystem.overlay.list()` to list all overlays
  - Add `sandbox.filesystem.overlay.retrieve(id)` to get overlay status (useful for polling)
  - Add `sandbox.filesystem.overlay.destroy(id)` to delete overlays
  - Overlays symlink template files for instant access, then copy heavy directories in background

## 1.12.1

### Patch Changes

- 4decff7: feat: Add @computesdk/gateway package and remove mode system

  - New `@computesdk/gateway` package with Railway infrastructure provider for gateway server use
  - New `defineInfraProvider()` factory for infrastructure-only providers
  - New `defineCompute()` factory for user-facing gateway routing
  - Simplified `@computesdk/railway` from ~270 lines to ~55 lines (routes through gateway)
  - Removed mode system (`ProviderMode`, `BaseProviderConfig`, `defaultMode`)
  - Configurable Docker image with `computesdk/compute:latest` default
  - Export `ExplicitComputeConfig` type from computesdk

## 1.12.0

### Minor Changes

- fdda069: Add supervisor/daemon capabilities to server service

  - Add restart policies: `never`, `on-failure`, `always`
  - Add graceful shutdown with configurable timeout (SIGTERM → wait → SIGKILL)
  - Add inline environment variables support
  - Add process monitoring with `restart_count` and `exit_code` tracking
  - Expose server namespace in workbench REPL for testing

## 1.11.1

### Patch Changes

- 7c8d968: ## Handle `status: "creating"` in `find()` and `findOrCreate()`

  Added polling support for the gateway's new sandbox lifecycle status tracking. When a sandbox is being created by a concurrent request, the gateway now returns `status: "creating"` instead of creating a duplicate sandbox.

  The SDK now polls with exponential backoff (500ms → 2s, 1.5x factor) until the sandbox becomes ready or times out after 60 seconds.

  This is the client-side companion to computesdk/edge#97.

## 1.11.0

### Minor Changes

- 40d66fc: ## Streaming Output Support for `runCommand()`

  Added `onStdout` and `onStderr` callback options to `sandbox.runCommand()` for real-time output streaming:

  ```typescript
  await sandbox.runCommand("npm install", {
    onStdout: (data) => process.stdout.write(data),
    onStderr: (data) => process.stderr.write(data),
  });
  ```

  ### Streaming Modes

  | `background` | callbacks             | Behavior                           |
  | ------------ | --------------------- | ---------------------------------- |
  | `false`      | none                  | Wait for completion, return result |
  | `true`       | none                  | Return immediately                 |
  | `false`      | `onStdout`/`onStderr` | Stream output, wait for completion |
  | `true`       | `onStdout`/`onStderr` | Stream output, return immediately  |

  ### Two-Phase Streaming Flow

  Implemented a two-phase streaming protocol to prevent race conditions with fast commands:

  1. `POST /run/command` with `stream: true` returns a pending command with `cmd_id` and `channel`
  2. SDK subscribes to the channel via WebSocket
  3. SDK sends `command:start` to trigger execution
  4. Server broadcasts `command:stdout`, `command:stderr`, `command:exit` events

  This ensures the SDK is subscribed before the command runs.

  ## `sandbox.destroy()` Fix

  Fixed `sandbox.destroy()` to actually destroy the sandbox via the gateway API, not just disconnect the WebSocket.

  ## Provider Compatibility Tests

  Added comprehensive provider compatibility test suite that validates SDK functionality across providers (e2b, vercel, daytona, modal). Tests cover:

  - Sandbox lifecycle (create, connect, destroy)
  - File operations (read, write, exists, remove, mkdir, readdir)
  - Command execution (with cwd, env, background, streaming)
  - PTY terminals (create, write, output streaming, destroy)
  - Exec terminals (execute commands with result tracking)
  - URL generation for different ports

  ## CI Integration

  Added SDK integration test job to CI workflow that runs provider compatibility tests against e2b and vercel providers on PRs and main branch pushes.

  ## Workbench Improvements

  - Added SDK debugging documentation to README with examples for reproducing test failures
  - Added verbose mode for WebSocket debugging
  - Improved terminal and filesystem commands
  - Added `cd` command support

### Patch Changes

- Updated dependencies [40d66fc]
  - @computesdk/cmd@0.4.1

## 1.10.3

### Patch Changes

- Updated dependencies [6b0c820]
  - @computesdk/cmd@0.4.0

## 1.10.2

### Patch Changes

- 07e0953: Add setConfig() method, remove runtime parameter, UI package, and web framework examples

  **Breaking Changes:**

  - Removed `runtime` parameter from gateway's `CreateSandboxOptions` - runtime is determined by the provider, not specified at creation time
  - Removed `handleComputeRequest` and related web framework integration exports (no longer needed)
  - Removed `@computesdk/ui` package (built for pre-gateway architecture, will be redesigned for gateway)
  - Removed web framework examples (Next.js, Nuxt, SvelteKit, Remix, Astro) - will be rebuilt for gateway architecture
  - Use `sandbox.runCode(code, runtime)` to specify which runtime to use for execution

  **New Features:**

  - Added `compute.setConfig()` method for explicit configuration
  - Updated error messages to reference `setConfig()` instead of callable pattern

  **Two Ways to Use ComputeSDK:**

  1. **Using ComputeSDK** (recommended):

     - `import { compute } from 'computesdk'`
     - Zero-config with environment variables or explicit `compute.setConfig()`
     - Works with all providers through unified interface

  2. **Using providers directly** (advanced):
     - `import { e2b } from '@computesdk/e2b'`
     - Use provider SDKs directly without ComputeSDK wrapper
     - Useful for local providers (Docker) or provider-specific features

  **Runtime Selection:**
  Runtime is no longer specified at sandbox creation. Instead, specify it when executing code:

  - `sandbox.runCode(pythonCode, 'python')` - Execute Python code
  - `sandbox.runCode(nodeCode, 'node')` - Execute Node.js code

  **Updated Examples:**
  All provider examples now demonstrate **using ComputeSDK**:

  - e2b-example.ts - Using ComputeSDK with E2B provider
  - modal-example.ts - Using ComputeSDK with Modal provider
  - daytona-example.ts - Using ComputeSDK with Daytona provider
  - docker-example.ts - Using Docker provider directly (local, no gateway)
  - runloop-example.ts - Using ComputeSDK with Runloop provider
  - codesandbox-example.ts - Using ComputeSDK with CodeSandbox provider
  - blaxel-example.ts - Using ComputeSDK with Blaxel provider
  - vercel-example.ts - Using ComputeSDK with Vercel provider

  **Example Usage:**

  ```typescript
  // Using ComputeSDK with setConfig (recommended)
  import { compute } from "computesdk";
  compute.setConfig({
    provider: "e2b",
    apiKey: "computesdk_xxx",
    e2b: { apiKey: "e2b_xxx" },
  });
  const sandbox = await compute.sandbox.create();

  // Using ComputeSDK with zero-config (auto-detection)
  // Just set COMPUTESDK_API_KEY and E2B_API_KEY environment variables
  import { compute } from "computesdk";
  const sandbox = await compute.sandbox.create();

  // Using Docker provider directly (for local providers)
  import { docker } from "@computesdk/docker";
  const compute = docker({ image: { name: "python:3.11" } });
  const sandbox = await compute.sandbox.create();
  ```

## 1.10.1

### Patch Changes

- fa18a99: # Grandmother/Mother/Children Architecture Refactor

  Major architectural refactoring that splits computesdk into a clean three-tier structure.

  ## New Architecture

  - **computesdk** (Grandmother) - User-facing SDK with gateway HTTP + Sandbox client
  - **@computesdk/provider** (Mother) - Provider framework for building custom providers
  - **Provider packages** (Children) - Import from @computesdk/provider

  ## Changes to computesdk

  - Removed `setConfig()`, `getConfig()`, `clearConfig()` methods from compute singleton
  - Removed `createCompute()` (moved to @computesdk/provider)
  - Gateway now uses direct HTTP implementation (not a provider)
  - Merged @computesdk/client into computesdk package
  - Renamed `sandbox.kill()` → `sandbox.destroy()`

  ## New @computesdk/provider Package

  Contains the provider framework extracted from computesdk:

  - `defineProvider()` function for defining custom providers (renamed from `createProvider()`)
  - `createCompute()` for direct mode
  - Provider types and interfaces (Provider, ProviderSandbox, etc.)
  - Universal Sandbox interface types

  ### Why `defineProvider()`?

  We renamed `createProvider()` to `defineProvider()` to match modern framework conventions and improve developer experience:

  **Pattern Recognition:**

  - Vite: `defineConfig()`
  - Nuxt: `defineNuxtConfig()`
  - Vue: `defineComponent()`

  **Better Semantics:**

  - `createProvider` implies creating an instance (it actually returns a factory definition)
  - `defineProvider` means "define what this provider is" (accurate to what it does)
  - More intuitive for developers familiar with modern frameworks

  **Example:**

  ```typescript
  import { defineProvider } from "@computesdk/provider";

  export const modal = defineProvider({
    name: "modal",
    defaultMode: "direct",
    sandbox: {
      /* ... */
    },
    methods: {
      /* ... */
    },
  });
  ```

  ## Provider Package Updates

  All 12 provider packages now:

  - Import `defineProvider` from @computesdk/provider
  - Import types from @computesdk/provider (which re-exports from computesdk)
  - Have @computesdk/provider as a dependency

  ## Migration Guide

  ### Gateway Mode (unchanged)

  ```typescript
  import { compute } from "computesdk";
  const sandbox = await compute.sandbox.create(); // Auto-detects from env
  ```

  ### Direct Mode (new location)

  ```typescript
  import { createCompute } from "@computesdk/provider";
  import { e2b } from "@computesdk/e2b";

  const compute = createCompute({ defaultProvider: e2b({ apiKey: "xxx" }) });
  const sandbox = await compute.sandbox.create();
  ```

  ### Method Rename

  ```typescript
  // Before
  await sandbox.kill();

  // After
  await sandbox.destroy();
  ```

## 1.10.0

### Minor Changes

- 38caad9: Update gateway provider to use plural `/v1/sandboxes` endpoints for REST consistency

  - `POST /v1/sandboxes` - Create a new sandbox
  - `GET /v1/sandboxes/:id` - Get sandbox info
  - `DELETE /v1/sandboxes/:id` - Destroy sandbox
  - `POST /v1/sandboxes/:id/extend` - Extend sandbox expiration
  - `POST /v1/sandboxes/find-or-create` - Find or create by namespace/name
  - `POST /v1/sandboxes/find` - Find by namespace/name

  **Breaking Change:** Requires gateway version with plural endpoints (computesdk/edge#80)

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

## 1.9.6

### Patch Changes

- 251f324: Adding in support for many gateway providers

## 1.9.5

### Patch Changes

- b027cd9: Updating gateway versioning + install and setup
- Updated dependencies [b027cd9]
  - @computesdk/cmd@0.3.1
  - @computesdk/client@0.4.2

## 1.9.4

### Patch Changes

- Updated dependencies [729c9b1]
  - @computesdk/cmd@0.3.0
  - @computesdk/client@0.4.1

## 1.9.3

### Patch Changes

- f38470d: Fix getInstance() typing when using createCompute() with direct providers

  Fixed a type inference issue where `sandbox.getInstance()` returned `unknown` instead of the provider's native sandbox type when using `createCompute()` with a direct provider (e.g., E2B, Modal).

  The issue was caused by a forward declaration of the `Provider` interface in `sandbox.ts` that shadowed the real `Provider` interface from `provider.ts`, preventing proper type extraction.

  **Before:**

  ```typescript
  const provider = e2b({ apiKey: "key" });
  const compute = createCompute({ defaultProvider: provider });
  const sandbox = await compute.sandbox.create();
  const instance = sandbox.getInstance(); // Type: unknown ❌
  ```

  **After:**

  ```typescript
  const provider = e2b({ apiKey: "key" });
  const compute = createCompute({ defaultProvider: provider });
  const sandbox = await compute.sandbox.create();
  const instance = sandbox.getInstance(); // Type: E2BSandbox ✅
  const id = instance.sandboxId; // Works! ✅
  ```

- f38470d: Update homepage URL to www.computesdk.com

## 1.9.1

### Patch Changes

- 1ac5ad2: adding in mode to types

## 1.9.0

### Minor Changes

- 8002931: Adding in support for ClientSandbox to all packages

### Patch Changes

- Updated dependencies [8002931]
  - @computesdk/cmd@0.2.0
  - @computesdk/client@0.4.0

## 1.8.8

### Patch Changes

- a146b97: Adding in proper background command via background: true

## 1.8.7

### Patch Changes

- 04ffecf: Minor refactoring

## 1.8.6

### Patch Changes

- 51b9259: Adding support for Compute CLI
- Updated dependencies [51b9259]
  - @computesdk/client@0.3.5

## 1.8.5

### Patch Changes

- f0eef79: moving to access token
- f0eef79: Adding enhanced sandbox
- f0eef79: Waiting for a health server
- Updated dependencies [f0eef79]
- Updated dependencies [f0eef79]
  - @computesdk/client@0.3.4

## 1.8.4

### Patch Changes

- 11a3b8c: moving to access token
- 11a3b8c: Adding enhanced sandbox
- Updated dependencies [11a3b8c]
- Updated dependencies [11a3b8c]
  - @computesdk/client@0.3.3

## 1.8.3

### Patch Changes

- 483c700: Adding enhanced sandbox
- Updated dependencies [483c700]
  - @computesdk/client@0.3.2

## 1.8.2

### Patch Changes

- 66d50b9: update jwt token variable to match license server json

## 1.8.1

### Patch Changes

- Updated dependencies [3ebbbc2]
  - @computesdk/client@0.3.1

## 1.8.0

### Minor Changes

- 99b807c: Integrating packages w/ @computesdk/client

### Patch Changes

- Updated dependencies [99b807c]
  - @computesdk/client@0.3.0

## 1.7.6

### Patch Changes

- Updated dependencies [6296b62]
  - @computesdk/client@0.2.6

## 1.7.5

### Patch Changes

- Updated dependencies [97e01e2]
  - @computesdk/client@0.2.5

## 1.7.4

### Patch Changes

- Updated dependencies [356f7ab]
  - @computesdk/client@0.2.4

## 1.7.3

### Patch Changes

- Updated dependencies [7d21636]
  - @computesdk/client@0.2.3

## 1.7.2

### Patch Changes

- Updated dependencies [9e239be]
  - @computesdk/client@0.2.2

## 1.7.1

### Patch Changes

- Updated dependencies [567f763]
  - @computesdk/client@0.2.1

## 1.7.0

### Minor Changes

- 763a9a7: Fix getInstance() typing to return provider-specific sandbox types

  The `getInstance()` method now returns properly typed provider instances instead of the generic `Sandbox` type. This enables full TypeScript intellisense and type safety when working with provider-specific methods and properties.

  **Before:**

  ```typescript
  const instance = sandbox.getInstance(); // Returns generic Sandbox
  // No intellisense for E2B-specific methods
  ```

  **After:**

  ```typescript
  const compute = createCompute({
    defaultProvider: e2b({ apiKey: "your-key" }),
  });

  const sandbox = await compute.sandbox.create();
  const instance = sandbox.getInstance(); // Returns properly typed E2B Sandbox
  // Full intellisense: instance.sandboxId, instance.commands, instance.files, etc.
  ```

  This change uses a phantom type approach (`__sandboxType`) to preserve type information through the provider chain, enabling TypeScript to correctly infer the native sandbox type.

## 1.6.0

### Minor Changes

- 19e4fe6: Add createCompute() function with proper getInstance() typing

  - Add new createCompute() function that preserves provider type information
  - Fix getInstance() returning 'any' type when using default provider configuration
  - Add TypedComputeAPI interface for type-safe compute operations
  - Maintain full backward compatibility with existing compute singleton

  Usage:

  ```typescript
  import { createCompute } from "computesdk";
  import { e2b } from "@computesdk/e2b";

  const compute = createCompute({
    defaultProvider: e2b({ apiKey: "your-key" }),
  });

  const sandbox = await compute.sandbox.create();
  const instance = sandbox.getInstance(); // ✅ Properly typed!
  ```

## 1.5.0

### Minor Changes

- ede314a: Improve getInstance() type inference with generic setConfig. When using setConfig with a defaultProvider, getInstance() now returns the properly typed native provider instance instead of 'any', enabling full type safety and autocomplete for provider-specific APIs.

## 1.4.0

### Minor Changes

- 3b23385: swtiching to core e2b package (whoops)

## 1.3.1

### Patch Changes

- be556c2: Fix getInstance() type inference to eliminate need for manual type casting

  Previously, `getInstance()` required explicit type parameters even when providers implemented typed methods:

  ```typescript
  // Before (required manual casting)
  await sandbox.getInstance<E2BSandbox>().setTimeout(minDurationMs);
  ```

  Now type inference works automatically:

  ```typescript
  // After (automatic type inference)
  await sandbox.getInstance().setTimeout(minDurationMs);
  ```

  **Technical Details:**

  - Fixed factory's `getInstance()` method to use proper generic constraints
  - Updated Sandbox interface with function overloads for better type inference
  - Preserved backward compatibility with explicit type parameters
  - Added comprehensive test coverage for type inference scenarios

  **Root Cause:**
  The factory was casting provider-specific types through `unknown`, breaking TypeScript's type inference chain.

  **Solution:**

  - Constrained generic `T` to extend `TSandbox` for safe casting
  - Added overloaded signatures to support both implicit and explicit typing
  - Removed unnecessary `unknown` type casting that broke inference

## 1.3.0

### Minor Changes

- fdb1271: Releasing sandbox instances via getInstance method

## 1.2.0

### Minor Changes

- 1fa3690: Adding instance typing
- 485f706: adding in getInstance w/ typing
- 2b537df: improving standard methods on provider

### Patch Changes

- 8d807e6: Updating meta

## 1.1.0

### Minor Changes

- d3ec023: improving core SDK to use provider factory methods
- df4df20: improvement: no longer shall we require an empty param on the creating of a sandbox. No longer shall it be required i say.
- 1302a77: feat: initial release
- a81d748: Updating README and examples for core package

## 1.0.0

### Major Changes

- Initial public release of ComputeSDK with production-ready providers:

  - **E2B Provider**: Full E2B Code Interpreter integration with comprehensive error handling, environment validation, and complete documentation
  - **Vercel Provider**: Vercel Sandbox API integration supporting Node.js and Python runtimes with team/project management
  - **Daytona Provider**: Daytona workspace integration with full filesystem support and development environment capabilities
  - **Core SDK**: Unified API for sandbox management, auto-detection, and extensible provider system

  Features:

  - TypeScript support with full type definitions
  - Comprehensive error handling and validation
  - Auto-detection of available providers
  - Support for Python and Node.js runtimes
  - Production-ready implementations with real provider APIs
  - Extensive documentation and examples

  This release marks the first stable version ready for production use.

### Patch Changes

- Updated dependencies
  - @computesdk/e2b@1.0.0
  - @computesdk/vercel@1.0.0
  - @computesdk/daytona@1.0.0
