# @computesdk/runloop

## 1.3.34

### Patch Changes

- Updated dependencies [5b010a3]
  - computesdk@2.2.1
  - @computesdk/provider@1.0.27

## 1.3.33

### Patch Changes

- Updated dependencies [55b793e]
  - computesdk@2.2.0
  - @computesdk/provider@1.0.26

## 1.3.32

### Patch Changes

- Updated dependencies [a5a7f63]
  - computesdk@2.1.2
  - @computesdk/provider@1.0.25

## 1.3.31

### Patch Changes

- Updated dependencies [2c9468b]
  - computesdk@2.1.1
  - @computesdk/provider@1.0.24

## 1.3.30

### Patch Changes

- Updated dependencies [9e7e50a]
  - computesdk@2.1.0
  - @computesdk/provider@1.0.23

## 1.3.29

### Patch Changes

- Updated dependencies [e3ed89b]
  - computesdk@2.0.2
  - @computesdk/provider@1.0.22

## 1.3.28

### Patch Changes

- ca82472: Bump versions to skip burned version numbers from rollback.

## 1.3.27

### Patch Changes

- Updated dependencies [53506ed]
  - computesdk@2.0.1
  - @computesdk/provider@1.0.21

## 1.3.26

### Patch Changes

- Updated dependencies [9946e72]
  - computesdk@1.21.1
  - @computesdk/provider@1.0.20

## 1.3.25

### Patch Changes

- Updated dependencies [7ba17e1]
  - computesdk@1.21.0
  - @computesdk/provider@1.0.19

## 1.3.24

### Patch Changes

- Updated dependencies [2b30125]
- Updated dependencies [2b30125]
  - computesdk@1.20.0
  - @computesdk/provider@1.0.18

## 1.3.23

### Patch Changes

- Updated dependencies [68b5296]
  - computesdk@1.19.0
  - @computesdk/provider@1.0.17

## 1.3.22

### Patch Changes

- Updated dependencies [59147ac]
  - computesdk@1.18.2
  - @computesdk/provider@1.0.16

## 1.3.21

### Patch Changes

- Updated dependencies [688ca54]
- Updated dependencies [688ca54]
  - computesdk@1.18.1
  - @computesdk/provider@1.0.15

## 1.3.20

### Patch Changes

- Updated dependencies [128edac]
  - computesdk@1.18.0
  - @computesdk/provider@1.0.14

## 1.3.19

### Patch Changes

- Updated dependencies [79c9fc5]
  - computesdk@1.17.0
  - @computesdk/provider@1.0.13

## 1.3.18

### Patch Changes

- Updated dependencies [208a400]
  - computesdk@1.16.0
  - @computesdk/provider@1.0.12

## 1.3.17

### Patch Changes

- Updated dependencies [25341eb]
  - computesdk@1.15.0
  - @computesdk/provider@1.0.11

## 1.3.16

### Patch Changes

- Updated dependencies [0c58ba9]
  - computesdk@1.14.0
  - @computesdk/provider@1.0.10

## 1.3.15

### Patch Changes

- Updated dependencies [3333388]
  - computesdk@1.13.0
  - @computesdk/provider@1.0.9

## 1.3.14

### Patch Changes

- Updated dependencies [4decff7]
  - @computesdk/provider@1.0.8
  - computesdk@1.12.1

## 1.3.13

### Patch Changes

- Updated dependencies [fdda069]
  - computesdk@1.12.0
  - @computesdk/provider@1.0.7

## 1.3.12

### Patch Changes

- Updated dependencies [7c8d968]
  - computesdk@1.11.1
  - @computesdk/provider@1.0.6

## 1.3.11

### Patch Changes

- Updated dependencies [40d66fc]
  - computesdk@1.11.0
  - @computesdk/provider@1.0.5

## 1.3.10

### Patch Changes

- computesdk@1.10.3
- @computesdk/provider@1.0.4

## 1.3.9

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

## 1.3.8

### Patch Changes

- Updated dependencies [07e0953]
  - computesdk@1.10.2
  - @computesdk/provider@1.0.2

## 1.3.7

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

## 1.3.6

### Patch Changes

- Updated dependencies [38caad9]
- Updated dependencies [f2d4273]
  - computesdk@1.10.0

## 1.3.5

### Patch Changes

- Updated dependencies [251f324]
  - computesdk@1.9.6

## 1.3.4

### Patch Changes

- Updated dependencies [b027cd9]
  - computesdk@1.9.5

## 1.3.3

### Patch Changes

- computesdk@1.9.4

## 1.3.2

### Patch Changes

- Updated dependencies [f38470d]
- Updated dependencies [f38470d]
  - computesdk@1.9.3

## 1.3.1

### Patch Changes

- Updated dependencies [1ac5ad2]
  - computesdk@1.9.1

## 1.3.0

### Minor Changes

- 8002931: Adding in support for ClientSandbox to all packages

### Patch Changes

- Updated dependencies [8002931]
  - computesdk@1.9.0

## 1.2.8

### Patch Changes

- Updated dependencies [a146b97]
  - computesdk@1.8.8

## 1.2.7

### Patch Changes

- Updated dependencies [04ffecf]
  - computesdk@1.8.7

## 1.2.6

### Patch Changes

- 51b9259: Adding support for Compute CLI
- Updated dependencies [51b9259]
  - computesdk@1.8.6

## 1.2.5

### Patch Changes

- Updated dependencies [f0eef79]
- Updated dependencies [f0eef79]
- Updated dependencies [f0eef79]
  - computesdk@1.8.5

## 1.2.4

### Patch Changes

- Updated dependencies [11a3b8c]
- Updated dependencies [11a3b8c]
  - computesdk@1.8.4

## 1.2.3

### Patch Changes

- Updated dependencies [483c700]
  - computesdk@1.8.3

## 1.2.2

### Patch Changes

- Updated dependencies [66d50b9]
  - computesdk@1.8.2

## 1.2.1

### Patch Changes

- computesdk@1.8.1

## 1.2.0

### Minor Changes

- 99b807c: Integrating packages w/ @computesdk/client

### Patch Changes

- Updated dependencies [99b807c]
  - computesdk@1.8.0

## 1.1.6

### Patch Changes

- computesdk@1.7.6

## 1.1.5

### Patch Changes

- computesdk@1.7.5

## 1.1.4

### Patch Changes

- computesdk@1.7.4

## 1.1.3

### Patch Changes

- computesdk@1.7.3

## 1.1.2

### Patch Changes

- computesdk@1.7.2

## 1.1.1

### Patch Changes

- computesdk@1.7.1

## 1.1.0

### Minor Changes

- c9cef90: Minor bump for all packages
