# @computesdk/gravixlayer

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
