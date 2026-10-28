# @computesdk/platform

## 0.2.0

### Minor Changes

- 0a54571: New `@computesdk/platform` provider: hosted ComputeSDK Platform sandboxes behind the same `compute`/`sandbox` interface — market placement, own-keys provider orders, quotes and org billing handled server-side. The shared transport (`PlatformClient`, `PlatformApiError`, `PlatformClientError`, `resolvePlatformAuth`, SSE readers) moved out of the CLI into this package; the CLI imports it and keeps the old `actions-client` names re-exported for one release. `compute sandboxes exec` gains `--cwd` and `-e/--env` like `spawn`. In `computesdk`, `createWithFallback` now rethrows immediately on an error flagged `fallback: false`, and the all-failed error keeps the original errors on `.errors`.

### Patch Changes

- Updated dependencies [2bd2e7d]
  - @computesdk/provider@2.1.20
