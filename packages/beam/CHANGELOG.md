# @computesdk/beam

## 0.1.2

### Patch Changes

- 5454416: Forward CreateSandboxOptions consistently to all provider SDKs. Known fields (timeout, envs, name, metadata, templateId, snapshotId) are now properly mapped and forwarded with correct renaming per provider. Arbitrary provider-specific options are passed through via rest-spread so users can set options like cpu, memory, gpu, resources, etc. through the unified interface.
- Updated dependencies [5454416]
  - computesdk@2.5.0
  - @computesdk/provider@1.0.30

## 0.1.1

### Patch Changes

- Updated dependencies [3c4e595]
  - computesdk@2.4.0
  - @computesdk/provider@1.0.29
