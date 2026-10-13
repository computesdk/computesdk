# @computesdk/sandbox0

## 1.0.12

### Patch Changes

- ef8770f: Docs: update examples to the canonical `compute.instances` API (`Instance*` type names, `instanceId`, `methods.instances`). `compute.sandbox` / `Sandbox*` / `methods.sandbox` remain working deprecated aliases.
- Updated dependencies [ef8770f]
  - @computesdk/provider@2.1.14
  - computesdk@4.1.12

## 1.0.11

### Patch Changes

- aadc200: Rename `compute.sandbox` to `compute.instances` and `Sandbox` to `Instance` across the SDK so the abstraction covers all compute forms (sandbox, VM, baremetal). `kind: 'sandbox' | 'vm' | 'baremetal'` is now a field on `CreateInstanceOptions`, `InstanceInfo`, and provider configs. `compute.sandbox`, `methods.sandbox`, `sandboxId`, and all `Sandbox*` type names remain as deprecated aliases so existing providers and callers keep working unchanged. CLI: `compute sandboxes` is now `compute instances` (`sandboxes`/`sbx` aliases preserved).
- Updated dependencies [aadc200]
  - computesdk@4.1.11
  - @computesdk/provider@2.1.13

## 1.0.10

### Patch Changes

- Updated dependencies [16074f4]
  - @computesdk/provider@2.1.12

## 1.0.9

### Patch Changes

- Updated dependencies [7240d21]
  - computesdk@4.1.10
  - @computesdk/provider@2.1.11

## 1.0.8

### Patch Changes

- Updated dependencies [f1a8578]
  - @computesdk/provider@2.1.10
  - computesdk@4.1.9

## 1.0.7

### Patch Changes

- computesdk@4.1.8
- @computesdk/provider@2.1.9

## 1.0.6

### Patch Changes

- Updated dependencies [7e65fe7]
  - @computesdk/provider@2.1.8
  - computesdk@4.1.7

## 1.0.5

### Patch Changes

- Updated dependencies [0732fed]
  - computesdk@4.1.6
  - @computesdk/provider@2.1.7

## 1.0.4

### Patch Changes

- Updated dependencies [3914faa]
  - computesdk@4.1.5
  - @computesdk/provider@2.1.6

## 1.0.3

### Patch Changes

- Updated dependencies [6ec91ff]
  - @computesdk/provider@2.1.5

## 1.0.2

### Patch Changes

- 4215f31: Run foreground commands through asynchronous Sandbox0 Contexts so long-running
  commands are not limited by a synchronous gateway request.

## 1.0.1

### Patch Changes

- b1aace9: Add a Sandbox0 provider with sandbox lifecycle, shell command execution, native filesystem access, existing service URLs, and idempotent cleanup.

## 1.0.0

### Patch Changes

- Initial Sandbox0 provider for ComputeSDK.
