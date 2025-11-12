# @computesdk/test-utils

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
