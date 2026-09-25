# @computesdk/superserve

## 0.2.7

### Patch Changes

- computesdk@4.1.8
- @computesdk/provider@2.1.9

## 0.2.6

### Patch Changes

- 1f0a8f4: Resolve relative `filesystem.*` paths to an absolute workdir before calling the provider's filesystem API (which requires absolute paths). Relative paths now resolve against the sandbox's exec cwd — falling back to `$HOME` on Tensorlake when the cwd isn't writable — matching what `runCommand` execs see. `.` and duplicate slashes normalize; `..` is preserved for physical resolution.

## 0.2.5

### Patch Changes

- Updated dependencies [7e65fe7]
  - @computesdk/provider@2.1.8
  - computesdk@4.1.7

## 0.2.4

### Patch Changes

- Updated dependencies [0732fed]
  - computesdk@4.1.6
  - @computesdk/provider@2.1.7

## 0.2.3

### Patch Changes

- Updated dependencies [3914faa]
  - computesdk@4.1.5
  - @computesdk/provider@2.1.6

## 0.2.2

### Patch Changes

- Updated dependencies [6ec91ff]
  - @computesdk/provider@2.1.5

## 0.2.1

### Patch Changes

- Updated dependencies [f3fe311]
  - computesdk@4.1.4
  - @computesdk/provider@2.1.4

## 0.2.0

### Minor Changes

- 3fb1171: Add the initial Superserve provider package. Superserve provides sandbox infrastructure to run code in isolated cloud environments powered by Firecracker MicroVMs. Wraps `@superserve/sdk` to expose sandbox lifecycle (create, connect, list, destroy), command execution, filesystem operations, and template listing through the standard ComputeSDK provider interface.
