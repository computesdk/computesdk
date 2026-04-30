# @computesdk/render

## 1.3.2

### Patch Changes

- Updated dependencies [aa4ca58]
  - computesdk@4.0.0
  - @computesdk/provider@2.0.0

## 1.3.1

### Patch Changes

- Updated dependencies [3ef4817]
- Updated dependencies [371f667]
  - @computesdk/provider@1.4.0
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
  - @computesdk/provider@1.3.0

## 1.2.22

### Patch Changes

- Updated dependencies [7c53d28]
  - @computesdk/provider@1.2.0

## 1.2.21

### Patch Changes

- Updated dependencies [3e6a91a]
  - @computesdk/provider@1.1.0
  - computesdk@2.5.4

## 1.2.21

### Patch Changes

- Updated dependencies [9a312d2]
  - @computesdk/provider@1.1.0
  - computesdk@2.5.4

## 1.2.21

### Patch Changes

- Updated dependencies [b34d97f]
  - @computesdk/provider@1.1.0
  - computesdk@2.5.4

## 1.2.20

### Patch Changes

- Updated dependencies [45f918b]
  - computesdk@2.5.3
  - @computesdk/provider@1.0.33

## 1.2.20

### Patch Changes

- Updated dependencies [0b97465]
  - computesdk@2.5.3
  - @computesdk/provider@1.0.33

## 1.2.19

### Patch Changes

- Updated dependencies [5f1b08f]
  - computesdk@2.5.2
  - @computesdk/provider@1.0.32

## 1.2.16

### Patch Changes

- Updated dependencies [3c4e595]
  - computesdk@2.4.0
  - @computesdk/provider@1.0.29

## 1.2.15

### Patch Changes

- Updated dependencies [d49d036]
  - computesdk@2.3.0
  - @computesdk/provider@1.0.28

## 1.2.14

### Patch Changes

- Updated dependencies [5b010a3]
  - computesdk@2.2.1
  - @computesdk/provider@1.0.27

## 1.2.13

### Patch Changes

- Updated dependencies [55b793e]
  - computesdk@2.2.0
  - @computesdk/provider@1.0.26

## 1.2.12

### Patch Changes

- Updated dependencies [a5a7f63]
  - computesdk@2.1.2
  - @computesdk/provider@1.0.25

## 1.2.11

### Patch Changes

- Updated dependencies [2c9468b]
  - computesdk@2.1.1
  - @computesdk/provider@1.0.24

## 1.2.10

### Patch Changes

- Updated dependencies [9e7e50a]
  - computesdk@2.1.0
  - @computesdk/provider@1.0.23

## 1.2.9

### Patch Changes

- Updated dependencies [e3ed89b]
  - computesdk@2.0.2
  - @computesdk/provider@1.0.22

## 1.2.8

### Patch Changes

- ca82472: Bump versions to skip burned version numbers from rollback.

## 1.2.7

### Patch Changes

- Updated dependencies [53506ed]
  - computesdk@2.0.1
  - @computesdk/provider@1.0.21

## 1.2.6

### Patch Changes

- Updated dependencies [9946e72]
  - computesdk@1.21.1
  - @computesdk/provider@1.0.20

## 1.2.5

### Patch Changes

- Updated dependencies [7ba17e1]
  - computesdk@1.21.0
  - @computesdk/provider@1.0.19

## 1.2.4

### Patch Changes

- Updated dependencies [2b30125]
- Updated dependencies [2b30125]
  - computesdk@1.20.0
  - @computesdk/provider@1.0.18

## 1.2.3

### Patch Changes

- Updated dependencies [68b5296]
  - computesdk@1.19.0
  - @computesdk/provider@1.0.17

## 1.2.2

### Patch Changes

- Updated dependencies [59147ac]
  - computesdk@1.18.2
  - @computesdk/provider@1.0.16

## 1.2.1

### Patch Changes

- Updated dependencies [688ca54]
- Updated dependencies [688ca54]
  - computesdk@1.18.1
  - @computesdk/provider@1.0.15

## 1.2.0

### Minor Changes

- 128edac: refactor render package for gateway

### Patch Changes

- Updated dependencies [128edac]
  - computesdk@1.18.0
  - @computesdk/provider@1.0.14

## 1.1.19

### Patch Changes

- Updated dependencies [79c9fc5]
  - computesdk@1.17.0
  - @computesdk/provider@1.0.13

## 1.1.18

### Patch Changes

- Updated dependencies [208a400]
  - computesdk@1.16.0
  - @computesdk/provider@1.0.12

## 1.1.17

### Patch Changes

- Updated dependencies [25341eb]
  - computesdk@1.15.0
  - @computesdk/provider@1.0.11

## 1.1.16

### Patch Changes

- Updated dependencies [0c58ba9]
  - computesdk@1.14.0
  - @computesdk/provider@1.0.10

## 1.1.15

### Patch Changes

- Updated dependencies [3333388]
  - computesdk@1.13.0
  - @computesdk/provider@1.0.9

## 1.1.14

### Patch Changes

- Updated dependencies [4decff7]
  - @computesdk/provider@1.0.8
  - computesdk@1.12.1

## 1.1.13

### Patch Changes

- Updated dependencies [fdda069]
  - computesdk@1.12.0
  - @computesdk/provider@1.0.7

## 1.1.12

### Patch Changes

- Updated dependencies [7c8d968]
  - computesdk@1.11.1
  - @computesdk/provider@1.0.6

## 1.1.11

### Patch Changes

- Updated dependencies [40d66fc]
  - computesdk@1.11.0
  - @computesdk/provider@1.0.5

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

## 1.0.1

### Patch Changes

- a146b97: Adding in proper background command via background: true
- Updated dependencies [a146b97]
  - computesdk@1.8.8
