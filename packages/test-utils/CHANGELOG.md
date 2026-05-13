# @computesdk/test-utils

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

## 1.6.1

### Patch Changes

- 3e6a91a: Add browser provider abstraction and Browserbase provider

  - Add `BrowserProvider` interface and `defineBrowserProvider()` factory to `@computesdk/provider` for building cloud browser providers, parallel to the existing sandbox provider pattern
  - Ship `@computesdk/browserbase` as the first browser provider, wrapping the `@browserbasehq/sdk` with support for session lifecycle, profiles (contexts), extensions, logs, and recordings
  - Add `runBrowserProviderTestSuite()` to `@computesdk/test-utils` for integration testing browser providers
  - Register `browserbase` in `BROWSER_PROVIDER_AUTH` and related config maps in `computesdk`

## 1.6.1

### Patch Changes

- 9a312d2: Add browser provider abstraction and Browserbase provider

  - Add `BrowserProvider` interface and `defineBrowserProvider()` factory to `@computesdk/provider` for building cloud browser providers, parallel to the existing sandbox provider pattern
  - Ship `@computesdk/browserbase` as the first browser provider, wrapping the `@browserbasehq/sdk` with support for session lifecycle, profiles (contexts), extensions, logs, and recordings
  - Add `runBrowserProviderTestSuite()` to `@computesdk/test-utils` for integration testing browser providers
  - Register `browserbase` in `BROWSER_PROVIDER_AUTH` and related config maps in `computesdk`

## 1.6.1

### Patch Changes

- b34d97f: Add browser provider abstraction and Browserbase provider

  - Add `BrowserProvider` interface and `defineBrowserProvider()` factory to `@computesdk/provider` for building cloud browser providers, parallel to the existing sandbox provider pattern
  - Ship `@computesdk/browserbase` as the first browser provider, wrapping the `@browserbasehq/sdk` with support for session lifecycle, profiles (contexts), extensions, logs, and recordings
  - Add `runBrowserProviderTestSuite()` to `@computesdk/test-utils` for integration testing browser providers
  - Register `browserbase` in `BROWSER_PROVIDER_AUTH` and related config maps in `computesdk`

## 1.6.0

### Minor Changes

- 45f918b: Add object storage providers for S3, R2, and Tigris with a unified storage provider test suite

## 1.6.0

### Minor Changes

- 0b97465: Add object storage providers for S3, R2, and Tigris with a unified storage provider test suite

## 1.6.0

### Minor Changes

- b1d5204: Add object storage providers for S3, R2, and Tigris with a unified storage provider test suite

## 1.5.1

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

## 1.5.0

### Minor Changes

- 64569f1: implement ports update for modal

## 1.4.1

### Patch Changes

- 51b9259: Adding support for Compute CLI

## 1.4.0

### Minor Changes

- 99b807c: Integrating packages w/ @computesdk/client

## 1.3.1

### Patch Changes

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

## 1.3.0

### Minor Changes

- fdb1271: Releasing sandbox instances via getInstance method

## 1.2.0

### Minor Changes

- 1fa3690: Adding instance typing
- 485f706: adding in getInstance w/ typing
- 2b537df: improving standard methods on provider

## 1.1.0

### Minor Changes

- d3ec023: improving core SDK to use provider factory methods
