# @computesdk/run-cloud

## 1.0.4

### Patch Changes

- Updated dependencies [0732fed]
  - computesdk@4.1.6
  - @computesdk/provider@2.1.7

## 1.0.3

### Patch Changes

- Updated dependencies [3914faa]
  - computesdk@4.1.5
  - @computesdk/provider@2.1.6

## 1.0.2

### Patch Changes

- Updated dependencies [6ec91ff]
  - @computesdk/provider@2.1.5

## 1.0.1

### Patch Changes

- 87b2324: Add the Run Cloud provider with Firecracker sandbox lifecycle, commands, filesystem operations, and snapshots.
- 87b2324: Open and close Run Cloud public port URLs through the `@run-cloud/sdk` tunnel API, releasing an expiring tunnel when it is refreshed so long-lived sandboxes stay within the active tunnel limits. Also give the ESM bundle a `createRequire` shim, since bundling the ESM-only SDK inlines `ws` and its CommonJS sources call `require`.
- 87b2324: Automatically attach an idempotency key to Run Cloud sandbox creates when the caller does not supply one.
