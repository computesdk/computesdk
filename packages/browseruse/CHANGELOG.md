# @computesdk/browseruse

## 0.2.2

### Patch Changes

- Updated dependencies [cc79d78]
  - computesdk@4.1.0
  - @computesdk/provider@2.1.0

## 0.2.1

### Patch Changes

- d65c97b: Migrate S3 and R2 providers from direct AWS SDK usage to `@tigrisdata/storage`, including per-call config forwarding and improved object metadata handling on downloads.

  Align Tigris storage dependency usage across providers and include a BrowserUse typing fix for custom proxy configuration.

## 0.2.0

### Minor Changes

- b6bac63: Add `@computesdk/browseruse` and `@computesdk/steel` browser providers for cloud browser sessions with stealth mode, proxies, profiles, and session recording. Both expose Playwright-compatible CDP endpoints.

### Patch Changes

- Updated dependencies [aa4ca58]
  - computesdk@4.0.0
  - @computesdk/provider@2.0.0
