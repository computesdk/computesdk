# @computesdk/upstash

## 0.2.2

### Patch Changes

- 7c53d28: Add `buildShellCommand` utility to unify shell command building across providers

  Centralizes cwd/env handling into a single `buildShellCommand` function in
  `@computesdk/provider`, fixing bugs where env vars didn't work with cwd set
  (docker, sprites, hopx) and where values weren't properly quoted (namespace,
  sprites, hopx). All shell-based providers now use the shared utility.

- Updated dependencies [7c53d28]
  - @computesdk/provider@1.2.0

## 0.2.1

### Patch Changes

- Updated dependencies [3e6a91a]
  - @computesdk/provider@1.1.0
  - computesdk@2.5.4

## 0.2.1

### Patch Changes

- Updated dependencies [9a312d2]
  - @computesdk/provider@1.1.0
  - computesdk@2.5.4

## 0.2.1

### Patch Changes

- Updated dependencies [b34d97f]
  - @computesdk/provider@1.1.0
  - computesdk@2.5.4

## 0.2.0

### Minor Changes

- 45f918b: Add Upstash Box provider package with support for sandbox CRUD, code execution, shell commands, filesystem operations, preview URLs, and snapshots

### Patch Changes

- Updated dependencies [45f918b]
  - computesdk@2.5.3
  - @computesdk/provider@1.0.33

## 0.2.0

### Minor Changes

- 0b97465: Add Upstash Box provider package with support for sandbox CRUD, code execution, shell commands, filesystem operations, preview URLs, and snapshots

### Patch Changes

- Updated dependencies [0b97465]
  - computesdk@2.5.3
  - @computesdk/provider@1.0.33
