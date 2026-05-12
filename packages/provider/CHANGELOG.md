# @computesdk/provider

## 2.0.0

### Major Changes

- aa4ca58: Remove `Runtime` concept from SDK

  The `Runtime` type (`'node' | 'python' | 'deno' | 'bun'`) and associated
  `getSupportedRuntimes()` method were originally designed to support a
  `runCode()` API that has since been removed. With no runtime-dispatch logic
  remaining in the SDK, these are dead API surface.

  **Breaking changes:**

  - `Runtime` type removed from `computesdk` public exports
  - `runtime` field removed from `SandboxInfo`
  - `getSupportedRuntimes(): Runtime[]` removed from the `Provider` interface
  - Provider implementations no longer need to (and cannot) implement `getSupportedRuntimes()`
  - Test suite no longer iterates per-runtime; tests run once per sandbox

  **Migration:** Remove any calls to `provider.getSupportedRuntimes()` and any
  references to `SandboxInfo.runtime` in your code.

### Patch Changes

- Updated dependencies [aa4ca58]
  - computesdk@4.0.0

## 1.4.0

### Minor Changes

- 3ef4817: Add `@computesdk/hyperbrowser` browser provider and relax `BrowserSession.connectUrl` for list summaries.

  **`@computesdk/hyperbrowser`** (new package)

  - Wraps `@hyperbrowser/sdk` via the `defineBrowserProvider` factory, parallel to `@computesdk/browserbase`.
  - Implements session lifecycle (`create / getById / list / destroy / getConnectUrl`) using `wsEndpoint` as the connect URL, and maps `active/closed/error` to standard `running/completed/failed` statuses.
  - Maps session options: `stealth → useStealth`, `proxies (true | ProxyConfig[]) → useProxy / proxyServer / proxyCountry / proxyState / proxyCity` (Hyperbrowser supports a single proxy per session — first `ProxyConfig` wins), `viewport → screen`, `recording → enableWebRecording`, `logging → enableLogCapture`, `profileId → profile.{id, persistChanges}`, `region → region`, `timeout (sec) → timeoutMinutes`. `keepAlive` and `userMetadata` have no native equivalent.
  - Profiles: full CRUD via `client.profiles.*`.
  - Extensions: `create` materializes `Uint8Array`/`string` payloads to a temp file (the SDK only accepts `filePath`); `get` filters `client.extensions.list()`; `delete` throws because Hyperbrowser exposes no delete endpoint.
  - Logs: `client.sessions.eventLogs.list` mapped to `BrowserLog` (`captcha_error → error`, others → `info`).
  - Recordings: combines `getRecordingURL` and `getRecording` into a single `BrowserRecording` (`format: 'rrweb'`).

  **`@computesdk/provider`** (breaking type relaxation)

  - `BrowserSession.connectUrl` is now optional (`string | undefined`). Always populated by `create()` and `getById()`; may be omitted on entries returned by `list()` when the underlying provider's list endpoint doesn't include it. Callers needing a connectable URL for a listed session should use `provider.getConnectUrl(sessionId)`.
  - `BrowserSessionMethods.list` return type relaxed accordingly. `create` and `getById` continue to require `connectUrl: string`.
  - Consumers reading `session.connectUrl` directly may need to add a null check, e.g. `session.connectUrl?.startsWith('wss://')`.

  **`@computesdk/browserbase`** and **`@computesdk/kernel`**

  - No code change; both already populate `connectUrl` on every session method, so they satisfy the looser type. Patch bumps track the upstream provider relaxation.

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

### Patch Changes

- Updated dependencies [371f667]
  - computesdk@3.0.0

## 1.3.0

### Minor Changes

- a321f01: Remove hosted control-plane assumptions from `computesdk` and move to direct provider mode.

  ### `computesdk`

  - Remove gateway/control-plane transport from `compute`; `compute.sandbox.*` now routes directly to configured provider instances.
  - Replace legacy config pathways with direct provider configuration only:
    - `compute.setConfig({ provider })`
    - `compute.setConfig({ providers: [...] })`
  - Add multi-provider routing support with:
    - `provider` + `providers` support
    - `providerStrategy` (`priority` / `round-robin`)
    - `fallbackOnError`
    - per-call provider override (`{ provider: 'name' }`)
  - Remove legacy hosted/gateway modules and exports (`auto-detect`, `explicit-config`, provider env/config exports).
  - Replace provider compatibility tests with direct-provider contract tests and new CI integration coverage.

  ### `@computesdk/provider`

  - Remove deprecated `defineCompute` and compute-factory exports that depended on hosted control-plane behavior.
  - Keep direct provider APIs (`defineProvider`, `createCompute`, `defineInfraProvider`).

  ### `@computesdk/railway` and `@computesdk/render`

  - Remove control-plane compute wrapper behavior.
  - Package entrypoints now throw explicit migration errors explaining that these wrappers are no longer supported after control-plane removal.

  ### `@computesdk/workbench`

  - Remove dependency on deleted `computesdk` provider config exports.
  - Inline provider env/auth metadata and switch compute instantiation to direct provider instances in both mode paths.
  - This preserves workbench mode UX while removing legacy control-plane config usage.

  ### Migration Notes

  - Stop using legacy config shapes such as provider-name strings with control-plane keys.
  - Configure `computesdk` with provider instances from provider packages.
  - For infrastructure packages previously used as control-plane wrappers (`@computesdk/railway`, `@computesdk/render`), migrate to supported direct provider packages.

### Patch Changes

- Updated dependencies [a321f01]
  - computesdk@2.6.0

## 1.2.0

### Minor Changes

- 7c53d28: Add `buildShellCommand` utility to unify shell command building across providers

  Centralizes cwd/env handling into a single `buildShellCommand` function in
  `@computesdk/provider`, fixing bugs where env vars didn't work with cwd set
  (docker, sprites, hopx) and where values weren't properly quoted (namespace,
  sprites, hopx). All shell-based providers now use the shared utility.

## 1.1.0

### Minor Changes

- 3e6a91a: Add browser provider abstraction and Browserbase provider

  - Add `BrowserProvider` interface and `defineBrowserProvider()` factory to `@computesdk/provider` for building cloud browser providers, parallel to the existing sandbox provider pattern
  - Ship `@computesdk/browserbase` as the first browser provider, wrapping the `@browserbasehq/sdk` with support for session lifecycle, profiles (contexts), extensions, logs, and recordings
  - Add `runBrowserProviderTestSuite()` to `@computesdk/test-utils` for integration testing browser providers
  - Register `browserbase` in `BROWSER_PROVIDER_AUTH` and related config maps in `computesdk`

### Patch Changes

- Updated dependencies [3e6a91a]
  - computesdk@2.5.4

## 1.1.0

### Minor Changes

- 9a312d2: Add browser provider abstraction and Browserbase provider

  - Add `BrowserProvider` interface and `defineBrowserProvider()` factory to `@computesdk/provider` for building cloud browser providers, parallel to the existing sandbox provider pattern
  - Ship `@computesdk/browserbase` as the first browser provider, wrapping the `@browserbasehq/sdk` with support for session lifecycle, profiles (contexts), extensions, logs, and recordings
  - Add `runBrowserProviderTestSuite()` to `@computesdk/test-utils` for integration testing browser providers
  - Register `browserbase` in `BROWSER_PROVIDER_AUTH` and related config maps in `computesdk`

### Patch Changes

- Updated dependencies [9a312d2]
  - computesdk@2.5.4

## 1.1.0

### Minor Changes

- b34d97f: Add browser provider abstraction and Browserbase provider

  - Add `BrowserProvider` interface and `defineBrowserProvider()` factory to `@computesdk/provider` for building cloud browser providers, parallel to the existing sandbox provider pattern
  - Ship `@computesdk/browserbase` as the first browser provider, wrapping the `@browserbasehq/sdk` with support for session lifecycle, profiles (contexts), extensions, logs, and recordings
  - Add `runBrowserProviderTestSuite()` to `@computesdk/test-utils` for integration testing browser providers
  - Register `browserbase` in `BROWSER_PROVIDER_AUTH` and related config maps in `computesdk`

### Patch Changes

- Updated dependencies [b34d97f]
  - computesdk@2.5.4

## 1.0.33

### Patch Changes

- Updated dependencies [45f918b]
  - computesdk@2.5.3

## 1.0.33

### Patch Changes

- Updated dependencies [0b97465]
  - computesdk@2.5.3

## 1.0.32

### Patch Changes

- Updated dependencies [5f1b08f]
  - computesdk@2.5.2

## 1.0.29

### Patch Changes

- Updated dependencies [3c4e595]
  - computesdk@2.4.0

## 1.0.28

### Patch Changes

- Updated dependencies [d49d036]
  - computesdk@2.3.0

## 1.0.27

### Patch Changes

- Updated dependencies [5b010a3]
  - computesdk@2.2.1

## 1.0.26

### Patch Changes

- Updated dependencies [55b793e]
  - computesdk@2.2.0

## 1.0.25

### Patch Changes

- Updated dependencies [a5a7f63]
  - computesdk@2.1.2

## 1.0.24

### Patch Changes

- Updated dependencies [2c9468b]
  - computesdk@2.1.1

## 1.0.23

### Patch Changes

- Updated dependencies [9e7e50a]
  - computesdk@2.1.0

## 1.0.22

### Patch Changes

- Updated dependencies [e3ed89b]
  - computesdk@2.0.2

## 1.0.21

### Patch Changes

- Updated dependencies [53506ed]
  - computesdk@2.0.1

## 1.0.20

### Patch Changes

- Updated dependencies [9946e72]
  - computesdk@1.21.1

## 1.0.19

### Patch Changes

- Updated dependencies [7ba17e1]
  - computesdk@1.21.0

## 1.0.18

### Patch Changes

- Updated dependencies [2b30125]
- Updated dependencies [2b30125]
  - computesdk@1.20.0

## 1.0.17

### Patch Changes

- Updated dependencies [68b5296]
  - computesdk@1.19.0

## 1.0.16

### Patch Changes

- Updated dependencies [59147ac]
  - computesdk@1.18.2

## 1.0.15

### Patch Changes

- Updated dependencies [688ca54]
- Updated dependencies [688ca54]
  - computesdk@1.18.1

## 1.0.14

### Patch Changes

- Updated dependencies [128edac]
  - computesdk@1.18.0

## 1.0.13

### Patch Changes

- Updated dependencies [79c9fc5]
  - computesdk@1.17.0

## 1.0.12

### Patch Changes

- Updated dependencies [208a400]
  - computesdk@1.16.0

## 1.0.11

### Patch Changes

- Updated dependencies [25341eb]
  - computesdk@1.15.0

## 1.0.10

### Patch Changes

- Updated dependencies [0c58ba9]
  - computesdk@1.14.0

## 1.0.9

### Patch Changes

- Updated dependencies [3333388]
  - computesdk@1.13.0

## 1.0.8

### Patch Changes

- 4decff7: feat: Add @computesdk/gateway package and remove mode system

  - New `@computesdk/gateway` package with Railway infrastructure provider for gateway server use
  - New `defineInfraProvider()` factory for infrastructure-only providers
  - New `defineCompute()` factory for user-facing gateway routing
  - Simplified `@computesdk/railway` from ~270 lines to ~55 lines (routes through gateway)
  - Removed mode system (`ProviderMode`, `BaseProviderConfig`, `defaultMode`)
  - Configurable Docker image with `computesdk/compute:latest` default
  - Export `ExplicitComputeConfig` type from computesdk

- Updated dependencies [4decff7]
  - computesdk@1.12.1

## 1.0.7

### Patch Changes

- Updated dependencies [fdda069]
  - computesdk@1.12.0

## 1.0.6

### Patch Changes

- Updated dependencies [7c8d968]
  - computesdk@1.11.1

## 1.0.5

### Patch Changes

- Updated dependencies [40d66fc]
  - computesdk@1.11.0
  - @computesdk/cmd@0.4.1

## 1.0.4

### Patch Changes

- Updated dependencies [6b0c820]
  - @computesdk/cmd@0.4.0
  - computesdk@1.10.3

## 1.0.3

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

## 1.0.2

### Patch Changes

- Updated dependencies [07e0953]
  - computesdk@1.10.2

## 1.0.1

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
