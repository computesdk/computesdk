# @computesdk/miosa

## 1.0.3

### Patch Changes

- d7a0e73: Implement snapshot deletion: resolve the owning sandbox from an in-process index populated by create/list, falling back to scanning the caller's sandboxes; idempotent on unknown or already-deleted snapshots

## 1.0.2

### Patch Changes

- 87c6f00: Map ComputeSDK resource hints (vcpus/memory) onto MIOSA size contracts

## 1.0.1

### Patch Changes

- 4db3c80: Add the MIOSA Firecracker microVM sandbox provider.
