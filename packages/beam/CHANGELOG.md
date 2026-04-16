# @computesdk/beam

## 0.1.8

### Patch Changes

- Updated dependencies [a321f01]
  - computesdk@2.6.0
  - @computesdk/provider@1.3.0

## 0.1.7

### Patch Changes

- 7c53d28: Add `buildShellCommand` utility to unify shell command building across providers

  Centralizes cwd/env handling into a single `buildShellCommand` function in
  `@computesdk/provider`, fixing bugs where env vars didn't work with cwd set
  (docker, sprites, hopx) and where values weren't properly quoted (namespace,
  sprites, hopx). All shell-based providers now use the shared utility.

- Updated dependencies [7c53d28]
  - @computesdk/provider@1.2.0

## 0.1.6

### Patch Changes

- Updated dependencies [3e6a91a]
  - @computesdk/provider@1.1.0
  - computesdk@2.5.4

## 0.1.6

### Patch Changes

- Updated dependencies [9a312d2]
  - @computesdk/provider@1.1.0
  - computesdk@2.5.4

## 0.1.6

### Patch Changes

- Updated dependencies [b34d97f]
  - @computesdk/provider@1.1.0
  - computesdk@2.5.4

## 0.1.5

### Patch Changes

- Updated dependencies [45f918b]
  - computesdk@2.5.3
  - @computesdk/provider@1.0.33

## 0.1.5

### Patch Changes

- Updated dependencies [0b97465]
  - computesdk@2.5.3
  - @computesdk/provider@1.0.33

## 0.1.4

### Patch Changes

- Updated dependencies [5f1b08f]
  - computesdk@2.5.2
  - @computesdk/provider@1.0.32

## 0.1.1

### Patch Changes

- Updated dependencies [3c4e595]
  - computesdk@2.4.0
  - @computesdk/provider@1.0.29
