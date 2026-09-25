# @computesdk/sail

## 1.0.8

### Patch Changes

- computesdk@4.1.8
- @computesdk/provider@2.1.9

## 1.0.7

### Patch Changes

- ea5be06: Harden the relative `filesystem.*` path resolution: `remove(''|'.'|'./')` no longer collapses to the sandbox workdir (it is rejected before resolution instead of recursively deleting it), and a failed `pwd` workdir probe is evicted instead of being cached as `/` forever — the next filesystem operation probes again.

## 1.0.6

### Patch Changes

- Updated dependencies [7e65fe7]
  - @computesdk/provider@2.1.8
  - computesdk@4.1.7

## 1.0.5

### Patch Changes

- a5b4353: Accept relative paths in `sandbox.filesystem` operations. Providers whose native file APIs require absolute paths (Modal `filesystem.*`, createos `files.*`, Sail `fs.*`) previously rejected or misrouted relative paths; they are now resolved against the sandbox's exec working directory — probed once via `pwd` and cached — so `filesystem.writeFile('a.txt', ...)` and `runCommand('cat a.txt')` address the same file. Absolute paths skip the probe entirely; `.` segments and duplicate slashes are normalized, while `..` segments are left for the sandbox filesystem to resolve physically.

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

- a2986a2: Add the Sail sandbox provider with lifecycle, command execution, native filesystem, ingress URL, resource sizing, and cancellation support.

## 1.0.0

### Patch Changes

- Initial Sail provider for ComputeSDK.
