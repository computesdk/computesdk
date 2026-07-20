# @computesdk/lelantos

## 0.2.2

### Patch Changes

- Updated dependencies [f3fe311]
  - computesdk@4.1.4
  - @computesdk/provider@2.1.4

## 0.2.1

### Patch Changes

- 44de339: Fix out-of-the-box connectivity for the Lelantos provider. Previously, with no `domain` configured (the README Quick Start path), the underlying e2b SDK silently fell back to api.e2b.app and every call failed with "Lelantos authentication failed"; `domain` now defaults to `lelantos.ai` as documented. Also, native `lel_<hex>` API keys are now re-prefixed to their `e2b_<hex>` alias before reaching the e2b SDK, whose client-side key-format validation (`^e2b\_[0-9a-f]+# @computesdk/lelantos, enforced since e2b v2.27) rejected them — the Lelantos control plane resolves both forms to the same key.

## 0.2.0

### Minor Changes

- b144c15: Add the initial Lelantos provider package — EU-native Firecracker microVM sandboxes (E2B-API-compatible) with sandbox lifecycle, command execution (real exit codes), filesystem operations, per-port preview URLs, and snapshot/template support. The provider threads `domain` / `apiUrl` through every underlying SDK call and accepts both `lel_` and `e2b_` keys (LELANTOS_API_KEY → E2B_API_KEY fallback).
