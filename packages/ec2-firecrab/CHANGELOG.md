# @computesdk/ec2-firecrab

## 1.0.5

### Patch Changes

- 1904e82: Pass the live conformance suite: accept a base64-encoded host PEM (`EC2_FIRECRAB_SSH_KEY`), let an explicit `apiUrl` win over env SSH targets, support `background` commands, run commands with `sh -c` instead of a login shell (image profile banners no longer leak into stdout), enforce command timeouts in the guest and report them as a non-zero exit instead of throwing, and surface ssh's own error when the API tunnel fails.
- Updated dependencies [1904e82]
- Updated dependencies [1904e82]
- Updated dependencies [1904e82]
- Updated dependencies [1904e82]
- Updated dependencies [1904e82]
- Updated dependencies [4924af5]
  - @computesdk/provider@2.1.22
  - computesdk@4.1.16

## 1.0.4

### Patch Changes

- Updated dependencies [24803d6]
  - computesdk@4.1.15
  - @computesdk/provider@2.1.21

## 1.0.3

### Patch Changes

- Updated dependencies [2bd2e7d]
- Updated dependencies [0a54571]
  - @computesdk/provider@2.1.20
  - computesdk@4.1.14

## 1.0.2

### Patch Changes

- 91b5ee8: Fall back to the 120s default when `bootTimeoutMs` is non-finite or non-positive — an unbounded deadline would strand the allocated microVM.
- 168a8c5: Add `bootTimeoutMs` config for the create→running wait (default 120s) so bursts on small hosts aren't truncated by the hardcoded boot deadline.

## 1.0.1

### Patch Changes

- 90381f3: Add EC2 Firecrab provider — Firecracker microVMs on self-hosted EC2 via a firecrab host
