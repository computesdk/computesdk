# @computesdk/gravixlayer

## 1.0.14

### Patch Changes

- Updated dependencies [f062b5d]
  - @computesdk/provider@2.1.19

## 1.0.13

### Patch Changes

- Updated dependencies [ce95b5c]
  - @computesdk/provider@2.1.18

## 1.0.12

### Patch Changes

- Updated dependencies [4930f49]
  - @computesdk/provider@2.1.17

## 1.0.11

### Patch Changes

- Updated dependencies [cbabd5a]
- Updated dependencies [a3de4ae]
- Updated dependencies [2c5eb0c]
  - @computesdk/provider@2.1.16

## 1.0.10

### Patch Changes

- Updated dependencies [d7d8efc]
- Updated dependencies [1b639da]
  - computesdk@4.1.13
  - @computesdk/provider@2.1.15

## 1.0.9

### Patch Changes

- a0409a6: Send the create lease as `timeout` and the HTTP budget as `requestTimeoutMs`.
  In the new SDK, `timeout` is the product duration in seconds on every call —
  matching what ComputeSDK's own millisecond `timeout` always meant — and
  `timeoutSeconds` was removed. The 180s boot budget moves to
  `requestTimeoutMs`, the per-call HTTP deadline, so it can no longer be
  mistaken for a lifetime. Floors the SDK at ^0.1.36.

## 1.0.8

### Patch Changes

- ef8770f: Docs: update examples to the canonical `compute.instances` API (`Instance*` type names, `instanceId`, `methods.instances`). `compute.sandbox` / `Sandbox*` / `methods.sandbox` remain working deprecated aliases.
- Updated dependencies [ef8770f]
  - @computesdk/provider@2.1.14
  - computesdk@4.1.12

## 1.0.7

### Patch Changes

- aadc200: Rename `compute.sandbox` to `compute.instances` and `Sandbox` to `Instance` across the SDK so the abstraction covers all compute forms (sandbox, VM, baremetal). `kind: 'sandbox' | 'vm' | 'baremetal'` is now a field on `CreateInstanceOptions`, `InstanceInfo`, and provider configs. `compute.sandbox`, `methods.sandbox`, `sandboxId`, and all `Sandbox*` type names remain as deprecated aliases so existing providers and callers keep working unchanged. CLI: `compute sandboxes` is now `compute instances` (`sandboxes`/`sbx` aliases preserved).
- Updated dependencies [aadc200]
  - computesdk@4.1.11
  - @computesdk/provider@2.1.13

## 1.0.6

### Patch Changes

- Updated dependencies [16074f4]
  - @computesdk/provider@2.1.12

## 1.0.5

### Patch Changes

- e13a18e: Floor the `gravixlayer` SDK at ^0.1.34.

## 1.0.4

### Patch Changes

- d404179: Resolve a provider config object once in `getClient` — repeated calls on the same provider instance skip option resolution entirely, while instances with equivalent options still share one client and its session pool.
- 8d8adf6: Floor the `gravixlayer` SDK at ^0.1.32 so installs resolve the current transport with the eager session pool and `connect()` pre-connect API.

## 1.0.3

### Patch Changes

- 1b608c6: Floor the `gravixlayer` SDK at ^0.1.30 so installs resolve the pooled HTTP/2 transport the provider documents.

## 1.0.2

### Patch Changes

- Updated dependencies [7240d21]
  - computesdk@4.1.10
  - @computesdk/provider@2.1.11

## 1.0.1

### Patch Changes

- c70043c: Add GravixLayer provider
- Updated dependencies [f1a8578]
  - @computesdk/provider@2.1.10
  - computesdk@4.1.9
