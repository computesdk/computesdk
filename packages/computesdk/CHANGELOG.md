# computesdk

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
