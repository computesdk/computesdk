# computesdk

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
