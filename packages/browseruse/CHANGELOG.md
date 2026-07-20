# @computesdk/browseruse

## 0.2.8

### Patch Changes

- Updated dependencies [f3fe311]
  - computesdk@4.1.4
  - @computesdk/provider@2.1.4

## 0.2.7

### Patch Changes

- 328da85: Preserve explicit `stealth: false` and `proxies: false` browser session options where provider APIs support them, and warn once when a provider cannot honor the option.

## 0.2.6

### Patch Changes

- 2708bae: Return wss:// CDP connect URLs. The Browser Use API returns an https:// cdpUrl, which makes CDP clients such as Playwright perform an extra /json/version discovery request before opening the websocket. Rewriting the scheme to wss:// lets clients connect to the websocket directly.

## 0.2.5

### Patch Changes

- Updated dependencies [607a11b]
  - computesdk@4.1.3
  - @computesdk/provider@2.1.3

## 0.2.4

### Patch Changes

- computesdk@4.1.2
- @computesdk/provider@2.1.2

## 0.2.3

### Patch Changes

- Updated dependencies [eca5ec2]
  - computesdk@4.1.1
  - @computesdk/provider@2.1.1

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
