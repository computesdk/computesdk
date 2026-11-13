# @computesdk/platform

## 0.2.5

### Patch Changes

- a995462: Accept the `2xlarge` (16 vCPU / 32 GiB) and `3xlarge` (32 vCPU / 128 GiB) platform sizes on create, matching the platform API and CLI.

## 0.2.4

### Patch Changes

- da83167: Make the CLI router-first. `compute sandboxes settings` / `compute actions settings` show the router: managed routing (ComputeSDK default or your own managed order) and BYOK use, and `settings set` takes `--routing`, `--byok off|first|fallback|only` and `--byok-order` (`--order` stays as a hidden alias). New `compute sandboxes route` shows where a create would land, whether it's billed from ComputeSDK credit (managed) or by your provider (BYOK), the price and the router's walk; `quote` remains as a hidden alias. Sandbox output labels each placement managed or BYOK. Market commands and flags are hidden from help. `compute sandboxes create|route --provider daytona[,e2b]` narrows the router to those providers for one request, keeping its BYOK mode and order. Add `--byok` (only your own keys) or `--managed` (only ComputeSDK managed accounts) to override the router's BYOK mode for that request. `create --order` is hidden (still accepted). New `compute new` is short for `compute sandboxes create`; `compute new vercel` or `compute new --vercel` picks the provider (same as `--provider vercel`). `create` / `new` print where the router will place the sandbox (provider, managed or BYOK, size, who bills it) before waiting for it to boot.

## 0.2.3

### Patch Changes

- 7b74e97: Update the optional `@benchsdk/cli` peer to 0.9.3.
- Updated dependencies [8e11040]
  - @computesdk/provider@2.1.23

## 0.2.2

### Patch Changes

- Updated dependencies [1904e82]
- Updated dependencies [1904e82]
- Updated dependencies [1904e82]
- Updated dependencies [1904e82]
- Updated dependencies [1904e82]
- Updated dependencies [4924af5]
  - @computesdk/provider@2.1.22

## 0.2.1

### Patch Changes

- Updated dependencies [24803d6]
  - @computesdk/provider@2.1.21

## 0.2.0

### Minor Changes

- 0a54571: New `@computesdk/platform` provider: hosted ComputeSDK Platform sandboxes behind the same `compute`/`sandbox` interface — market placement, own-keys provider orders, quotes and org billing handled server-side. The shared transport (`PlatformClient`, `PlatformApiError`, `PlatformClientError`, `resolvePlatformAuth`, SSE readers) moved out of the CLI into this package; the CLI imports it and keeps the old `actions-client` names re-exported for one release. `compute sandboxes exec` gains `--cwd` and `-e/--env` like `spawn`. In `computesdk`, `createWithFallback` now rethrows immediately on an error flagged `fallback: false`, and the all-failed error keeps the original errors on `.errors`.

### Patch Changes

- Updated dependencies [2bd2e7d]
  - @computesdk/provider@2.1.20
