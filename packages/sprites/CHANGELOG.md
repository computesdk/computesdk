# @computesdk/sprites

## 0.1.1

### Patch Changes

- 49d4fc0: Forward CreateSandboxOptions consistently to all provider SDKs. Known fields (timeout, envs, name, metadata, templateId, snapshotId) are now properly mapped and forwarded with correct renaming per provider. Arbitrary provider-specific options are passed through via rest-spread so users can set options like cpu, memory, gpu, resources, etc. through the unified interface.
- Updated dependencies [49d4fc0]
- Updated dependencies [49d4fc0]
  - computesdk@2.5.0
  - @computesdk/provider@1.0.30

## 0.1.0

### Minor Changes

- 3c4e595: Add sprites provider package

### Patch Changes

- Updated dependencies [3c4e595]
  - computesdk@2.4.0
  - @computesdk/provider@1.0.29
