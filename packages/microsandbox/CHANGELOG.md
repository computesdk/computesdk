# @computesdk/microsandbox

## 0.1.5

### Patch Changes

- 4f2394e: Remove backend serialization for concurrent operations using one backend configuration per process, rejecting conflicting configurations before changing the SDK backend. Accept memoryMib and rootDiskMib in sandbox create options so requested resources are not silently replaced by defaults. Retry sandbox shutdown and deletion, and report failed cleanup of cancelled sandbox creation. Require Microsandbox SDK 0.6.18 or newer within the 0.6 release line. Default to ephemeral sandboxes with a 15-minute idle timeout; support explicit persistent and idle timeout overrides.

## 0.1.4

### Patch Changes

- Updated dependencies [0732fed]
  - computesdk@4.1.6
  - @computesdk/provider@2.1.7

## 0.1.3

### Patch Changes

- Updated dependencies [3914faa]
  - computesdk@4.1.5
  - @computesdk/provider@2.1.6

## 0.1.2

### Patch Changes

- 42a5158: Update microsandbox to 0.6.12 so the provider works on Linux systems with glibc 2.28 and newer.

## 0.1.1

### Patch Changes

- 183f0f1: Add a microsandbox provider with local and cloud backends, native command streaming, filesystem access, and local port and snapshot support.
