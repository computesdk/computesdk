# @computesdk/fly

## 1.1.10

### Patch Changes

- computesdk@1.10.3
- @computesdk/provider@1.0.4

## 1.1.9

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

## 1.1.8

### Patch Changes

- Updated dependencies [07e0953]
  - computesdk@1.10.2
  - @computesdk/provider@1.0.2

## 1.1.7

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

## 1.1.6

### Patch Changes

- Updated dependencies [38caad9]
- Updated dependencies [f2d4273]
  - computesdk@1.10.0

## 1.1.5

### Patch Changes

- Updated dependencies [251f324]
  - computesdk@1.9.6

## 1.1.4

### Patch Changes

- Updated dependencies [b027cd9]
  - computesdk@1.9.5

## 1.1.3

### Patch Changes

- computesdk@1.9.4

## 1.1.2

### Patch Changes

- Updated dependencies [f38470d]
- Updated dependencies [f38470d]
  - computesdk@1.9.3

## 1.1.1

### Patch Changes

- Updated dependencies [1ac5ad2]
  - computesdk@1.9.1

## 1.1.0

### Minor Changes

- 8002931: Adding in support for ClientSandbox to all packages

### Patch Changes

- Updated dependencies [8002931]
  - computesdk@1.9.0
