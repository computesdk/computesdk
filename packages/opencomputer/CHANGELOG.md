# @computesdk/opencomputer

## 1.0.4

### Patch Changes

- c93cc2d: Start the `@opencomputer/sdk` import at module load instead of at first use.

  The SDK initialises at import. `loadSandbox()` is first reached from
  `sandbox.create()`, so deferring the import there meant that initialisation
  happened during the first create rather than before it.

  The import stays dynamic: the SDK is ESM-only with top-level await, so a static
  import compiles to `require()` in this package's CJS build and fails to load.

## 1.0.3

### Patch Changes

- b832bc8: Bump `@nodeops-createos/sandbox` to `^0.8.1` and track `latest` for `@opencomputer/sdk`.

## 1.0.2

### Patch Changes

- Updated dependencies [6ec91ff]
  - @computesdk/provider@2.1.5

## 1.0.1

### Patch Changes

- 7bdc312: Add an OpenComputer provider with sandbox lifecycle, command execution, filesystem access, preview URLs, and checkpoint-backed snapshots.

## 1.0.0

### Patch Changes

- Initial OpenComputer provider for ComputeSDK.
