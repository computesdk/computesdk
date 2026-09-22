# @computesdk/mosaic

## 0.1.7

### Patch Changes

- Updated dependencies [7e65fe7]
  - @computesdk/provider@2.1.8
  - computesdk@4.1.7

## 0.1.6

### Patch Changes

- Updated dependencies [0732fed]
  - computesdk@4.1.6
  - @computesdk/provider@2.1.7

## 0.1.5

### Patch Changes

- Updated dependencies [3914faa]
  - computesdk@4.1.5
  - @computesdk/provider@2.1.6

## 0.1.4

### Patch Changes

- a4bc147: Bound how many HTTP requests the Mosaic provider keeps in flight, so a burst of concurrent sandbox creates no longer becomes a burst of TLS handshakes. Configurable with `maxConcurrentRequests` (default 32; `Infinity` restores the previous behaviour).

## 0.1.3

### Patch Changes

- Updated dependencies [6ec91ff]
  - @computesdk/provider@2.1.5

## 0.1.2

### Patch Changes

- 1665ea4: Support previews, filesystem, snapshots and image templates, and give sandboxes network access by default

## 0.1.1

### Patch Changes

- 59d39e1: Add the Mosaic sandbox provider for Firecracker-based command-execution environments.
