# @computesdk/vercel

## 1.7.26

### Patch Changes

- Updated dependencies [aa4ca58]
  - computesdk@4.0.0
  - @computesdk/provider@2.0.0

## 1.7.25

### Patch Changes

- 371f667: Remove the legacy daemon/client subsystem.

  **Breaking changes (`computesdk`):**

  - Removed the `Sandbox` client class and its entire `src/client/` subsystem (WebSocket protocol, resources, terminal/run/server/watcher/file/env/sessionToken/magicLink/signal/auth/child namespaces).
  - Removed re-exports: `Sandbox`, `SandboxStatus`, `ProviderSandboxInfo`, `CommandExitError`, `isCommandExitError`, `TerminalInstance`, `FileWatcher`, `SignalService`, `WebSocketConstructor`, `encodeBinaryMessage`, `decodeBinaryMessage`, `MessageType`, `buildSetupPayload`, `encodeSetupPayload`, `SetupPayload`, `SetupOverlayConfig`.
  - Removed the 11 optional advanced namespaces (`terminal?`, `run?`, `server?`, `watcher?`, `file?`, `env?`, `sessionToken?`, `magicLink?`, `signal?`, `auth?`, `child?`) from the `SandboxInterface`.
  - Removed `SandboxOverlayConfig`, `SandboxServerConfig`, `SandboxHealthCheckConfig` types.
  - Removed `overlays` and `servers` fields from `CreateSandboxOptions`.

  These APIs were only wired against the daemon transport, which was removed from the published package earlier. No shipped provider implemented them.

  **Breaking changes (`@computesdk/workbench`):**

  - Removed `workbench connect <url> [token]` (required the deleted `Sandbox` client class).
  - Removed `workbench provider local` and local-daemon auto-attach (required the deleted `Sandbox` client class).
  - Removed `mode gateway|direct` toggle and `provider direct <name>` / `provider gateway <name>` aliases.
  - Dropped the `child`, `server`, and `terminal` REPL bindings — they delegated to daemon-only namespaces.
  - Dropped `ws` runtime dependency.

  **Breaking changes (`@computesdk/cli`):**

  - Removed `pty` mode. `compute connect`, `compute sandbox connect`, `workspace attach`, and `sandbox create --connect` now drop into the REPL (`runCommand`-based) instead of an interactive PTY shell.
  - Removed the `/shell` REPL command that dropped into PTY.

  **Other:**

  - `@computesdk/provider` drops the optional `findOrCreate` / `find` / `extendTimeout` fields from `SandboxMethods` (matching the earlier compute-wrapper cleanup).
  - 14 provider packages get a patch bump for internal destructuring cleanup (removed unused `overlays` / `servers` destructure targets).

- Updated dependencies [3ef4817]
- Updated dependencies [371f667]
  - @computesdk/provider@1.4.0
  - computesdk@3.0.0

## 1.7.24

### Patch Changes

- Updated dependencies [a321f01]
  - computesdk@2.6.0
  - @computesdk/provider@1.3.0

## 1.7.23

### Patch Changes

- Updated dependencies [7c53d28]
  - @computesdk/provider@1.2.0

## 1.7.22

### Patch Changes

- aba08d4: Fix generic runtime name handling and improve `runCommand` performance:

  - Translate generic runtime names (`node`, `python`) to Vercel-supported versions (`node24`, `python3.13`) so the default provider runtime works end-to-end.
  - Use builtin `@vercel/sandbox` stdout/stderr pipes to avoid blocking `runCommand`.
  - Bump `@vercel/sandbox` to `^1.9.3`.

## 1.7.22

### Patch Changes

- 80ce13f: Fix generic runtime name handling and improve `runCommand` performance:

  - Translate generic runtime names (`node`, `python`) to Vercel-supported versions (`node24`, `python3.13`) so the default provider runtime works end-to-end.
  - Use builtin `@vercel/sandbox` stdout/stderr pipes to avoid blocking `runCommand`.
  - Bump `@vercel/sandbox` to `^1.9.3`.

## 1.7.21

### Patch Changes

- Updated dependencies [3e6a91a]
  - @computesdk/provider@1.1.0
  - computesdk@2.5.4

## 1.7.21

### Patch Changes

- Updated dependencies [9a312d2]
  - @computesdk/provider@1.1.0
  - computesdk@2.5.4

## 1.7.21

### Patch Changes

- Updated dependencies [b34d97f]
  - @computesdk/provider@1.1.0
  - computesdk@2.5.4

## 1.7.20

### Patch Changes

- Updated dependencies [45f918b]
  - computesdk@2.5.3
  - @computesdk/provider@1.0.33

## 1.7.20

### Patch Changes

- Updated dependencies [0b97465]
  - computesdk@2.5.3
  - @computesdk/provider@1.0.33

## 1.7.19

### Patch Changes

- Updated dependencies [5f1b08f]
  - computesdk@2.5.2
  - @computesdk/provider@1.0.32

## 1.7.16

### Patch Changes

- Updated dependencies [3c4e595]
  - computesdk@2.4.0
  - @computesdk/provider@1.0.29

## 1.7.15

### Patch Changes

- Updated dependencies [d49d036]
  - computesdk@2.3.0
  - @computesdk/provider@1.0.28

## 1.7.14

### Patch Changes

- f0bf381: Update packages for direct providers, fix runloop keep_alive default, and update daytona list method

## 1.7.13

### Patch Changes

- Updated dependencies [5b010a3]
  - computesdk@2.2.1
  - @computesdk/provider@1.0.27

## 1.7.12

### Patch Changes

- Updated dependencies [55b793e]
  - computesdk@2.2.0
  - @computesdk/provider@1.0.26

## 1.7.11

### Patch Changes

- Updated dependencies [a5a7f63]
  - computesdk@2.1.2
  - @computesdk/provider@1.0.25

## 1.7.10

### Patch Changes

- Updated dependencies [2c9468b]
  - computesdk@2.1.1
  - @computesdk/provider@1.0.24

## 1.7.9

### Patch Changes

- Updated dependencies [9e7e50a]
  - computesdk@2.1.0
  - @computesdk/provider@1.0.23

## 1.7.8

### Patch Changes

- 6c54170: Fix credential precedence and snapshot parameter handling

  **Credential Precedence Fix:**
  Previously, if `VERCEL_OIDC_TOKEN` was set in the environment, the provider would always use OIDC authentication and silently ignore any credentials passed via `setConfig()` or the provider constructor. This caused issues where explicitly configured credentials (token, teamId, projectId) were bypassed.

  Now the precedence is:

  1. Config values (from `setConfig()` or provider constructor) - always checked first
  2. Environment variables - used as fallback only when config values are not provided
  3. OIDC authentication - only used when no config credentials are provided AND `VERCEL_OIDC_TOKEN` is set

  **Snapshot Parameter Format Fix:**
  The provider now accepts both formats for specifying a snapshot:

  - ComputeSDK format: `{ snapshotId: 'snap_xxx' }` (top-level)
  - Vercel SDK format: `{ source: { type: 'snapshot', snapshotId: 'snap_xxx' } }` (nested)

  This ensures compatibility with both direct provider usage and gateway-based usage.

  These fixes affect all methods: `sandbox.create`, `sandbox.getById`, `sandbox.destroy`, `snapshot.create`, and `snapshot.delete`.

- Updated dependencies [e3ed89b]
  - computesdk@2.0.2
  - @computesdk/provider@1.0.22

## 1.7.7

### Patch Changes

- ca82472: Bump versions to skip burned version numbers from rollback.

## 1.7.6

### Patch Changes

- Updated dependencies [53506ed]
  - computesdk@2.0.1
  - @computesdk/provider@1.0.21

## 1.7.5

### Patch Changes

- Updated dependencies [9946e72]
  - computesdk@1.21.1
  - @computesdk/provider@1.0.20

## 1.7.4

### Patch Changes

- Updated dependencies [7ba17e1]
  - computesdk@1.21.0
  - @computesdk/provider@1.0.19

## 1.7.3

### Patch Changes

- Updated dependencies [2b30125]
- Updated dependencies [2b30125]
  - computesdk@1.20.0
  - @computesdk/provider@1.0.18

## 1.7.2

### Patch Changes

- Updated dependencies [68b5296]
  - computesdk@1.19.0
  - @computesdk/provider@1.0.17

## 1.7.1

### Patch Changes

- Updated dependencies [59147ac]
  - computesdk@1.18.2
  - @computesdk/provider@1.0.16

## 1.7.0

### Minor Changes

- 7f1553f: Add support for Vercel Sandbox snapshots:
  - Implement `snapshot.create()` and `snapshot.delete()`.
  - Support creating new sandboxes from snapshots via `sandbox.create({ snapshotId: '...' })`.

### Patch Changes

- 7f1553f: Update `@vercel/sandbox` dependency to latest version (`^1.2.0`).

## 1.6.21

### Patch Changes

- Updated dependencies [688ca54]
- Updated dependencies [688ca54]
  - computesdk@1.18.1
  - @computesdk/provider@1.0.15

## 1.6.20

### Patch Changes

- Updated dependencies [128edac]
  - computesdk@1.18.0
  - @computesdk/provider@1.0.14

## 1.6.19

### Patch Changes

- Updated dependencies [79c9fc5]
  - computesdk@1.17.0
  - @computesdk/provider@1.0.13

## 1.6.18

### Patch Changes

- Updated dependencies [208a400]
  - computesdk@1.16.0
  - @computesdk/provider@1.0.12

## 1.6.17

### Patch Changes

- Updated dependencies [25341eb]
  - computesdk@1.15.0
  - @computesdk/provider@1.0.11

## 1.6.16

### Patch Changes

- Updated dependencies [0c58ba9]
  - computesdk@1.14.0
  - @computesdk/provider@1.0.10

## 1.6.15

### Patch Changes

- Updated dependencies [3333388]
  - computesdk@1.13.0
  - @computesdk/provider@1.0.9

## 1.6.14

### Patch Changes

- Updated dependencies [4decff7]
  - @computesdk/provider@1.0.8
  - computesdk@1.12.1

## 1.6.13

### Patch Changes

- Updated dependencies [fdda069]
  - computesdk@1.12.0
  - @computesdk/provider@1.0.7

## 1.6.12

### Patch Changes

- Updated dependencies [7c8d968]
  - computesdk@1.11.1
  - @computesdk/provider@1.0.6

## 1.6.11

### Patch Changes

- Updated dependencies [40d66fc]
  - computesdk@1.11.0
  - @computesdk/provider@1.0.5

## 1.6.10

### Patch Changes

- computesdk@1.10.3
- @computesdk/provider@1.0.4

## 1.6.9

### Patch Changes

- acdc8c6: fix: align provider factory with clean command execution

  Updates all providers to use the new clean command signature introduced in #192.

  **Changes:**

  - Provider factory `runCommand` signature simplified from `(command, args?, options?)` to `(command, options?)`
  - All 13 providers updated to handle `cwd`, `env`, and `background` options by wrapping commands with shell constructs
  - Test suite updated to use clean command strings instead of args arrays

  **Related:**

  - Follows #192 which updated the gateway client to send clean commands
  - Part of the larger refactor to remove client-side command preprocessing

  **Migration:**
  Providers now receive clean command strings and handle options uniformly:

  ```typescript
  // Before
  runCommand(sandbox, "npm", ["install"], { cwd: "/app" });

  // After
  runCommand(sandbox, "npm install", { cwd: "/app" });
  ```

- Updated dependencies [acdc8c6]
  - @computesdk/provider@1.0.3

## 1.6.8

### Patch Changes

- Updated dependencies [07e0953]
  - computesdk@1.10.2
  - @computesdk/provider@1.0.2

## 1.6.7

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

- Updated dependencies [fa18a99]
  - computesdk@1.10.1
  - @computesdk/provider@1.0.1

## 1.6.6

### Patch Changes

- Updated dependencies [38caad9]
- Updated dependencies [f2d4273]
  - computesdk@1.10.0

## 1.6.5

### Patch Changes

- Updated dependencies [251f324]
  - computesdk@1.9.6

## 1.6.4

### Patch Changes

- Updated dependencies [b027cd9]
  - computesdk@1.9.5

## 1.6.3

### Patch Changes

- computesdk@1.9.4

## 1.6.2

### Patch Changes

- Updated dependencies [f38470d]
- Updated dependencies [f38470d]
  - computesdk@1.9.3

## 1.6.1

### Patch Changes

- Updated dependencies [1ac5ad2]
  - computesdk@1.9.1

## 1.6.0

### Minor Changes

- 8002931: Adding in support for ClientSandbox to all packages

### Patch Changes

- Updated dependencies [8002931]
  - computesdk@1.9.0

## 1.5.9

### Patch Changes

- 556169b: adding in basic fs

## 1.5.8

### Patch Changes

- a146b97: Adding in proper background command via background: true
- Updated dependencies [a146b97]
  - computesdk@1.8.8

## 1.5.7

### Patch Changes

- 04ffecf: Minor refactoring
- Updated dependencies [04ffecf]
  - computesdk@1.8.7

## 1.5.6

### Patch Changes

- 51b9259: Adding support for Compute CLI
- Updated dependencies [51b9259]
  - computesdk@1.8.6

## 1.5.5

### Patch Changes

- Updated dependencies [f0eef79]
- Updated dependencies [f0eef79]
- Updated dependencies [f0eef79]
  - computesdk@1.8.5

## 1.5.4

### Patch Changes

- Updated dependencies [11a3b8c]
- Updated dependencies [11a3b8c]
  - computesdk@1.8.4

## 1.5.3

### Patch Changes

- Updated dependencies [483c700]
  - computesdk@1.8.3

## 1.5.2

### Patch Changes

- Updated dependencies [66d50b9]
  - computesdk@1.8.2

## 1.5.1

### Patch Changes

- computesdk@1.8.1

## 1.5.0

### Minor Changes

- 99b807c: Integrating packages w/ @computesdk/client

### Patch Changes

- Updated dependencies [99b807c]
  - computesdk@1.8.0

## 1.4.6

### Patch Changes

- computesdk@1.7.6

## 1.4.5

### Patch Changes

- computesdk@1.7.5

## 1.4.4

### Patch Changes

- computesdk@1.7.4

## 1.4.3

### Patch Changes

- computesdk@1.7.3

## 1.4.2

### Patch Changes

- computesdk@1.7.2

## 1.4.1

### Patch Changes

- computesdk@1.7.1

## 1.4.0

### Minor Changes

- c9cef90: Minor bump for all packages

## 1.3.5

### Patch Changes

- Updated dependencies [763a9a7]
  - computesdk@1.7.0

## 1.3.4

### Patch Changes

- Updated dependencies [19e4fe6]
  - computesdk@1.6.0

## 1.3.3

### Patch Changes

- Updated dependencies [ede314a]
  - computesdk@1.5.0

## 1.3.2

### Patch Changes

- Updated dependencies [3b23385]
  - computesdk@1.4.0

## 1.3.1

### Patch Changes

- Updated dependencies [be556c2]
  - computesdk@1.3.1

## 1.3.0

### Minor Changes

- fdb1271: Releasing sandbox instances via getInstance method

### Patch Changes

- Updated dependencies [fdb1271]
  - computesdk@1.3.0

## 1.2.0

### Minor Changes

- 1fa3690: Adding instance typing
- 485f706: adding in getInstance w/ typing
- 2b537df: improving standard methods on provider

### Patch Changes

- Updated dependencies [1fa3690]
- Updated dependencies [485f706]
- Updated dependencies [2b537df]
- Updated dependencies [8d807e6]
  - computesdk@1.2.0

## 1.1.0

### Minor Changes

- d3ec023: improving core SDK to use provider factory methods
- 1302a77: feat: initial release

### Patch Changes

- Updated dependencies [d3ec023]
- Updated dependencies [df4df20]
- Updated dependencies [1302a77]
- Updated dependencies [a81d748]
  - computesdk@1.1.0

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
  - computesdk@1.0.0
