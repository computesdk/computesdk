# @computesdk/lelantos

## 0.2.0

### Minor Changes

- b144c15: Add the initial Lelantos provider package — EU-native Firecracker microVM sandboxes (E2B-API-compatible) with sandbox lifecycle, command execution (real exit codes), filesystem operations, per-port preview URLs, and snapshot/template support. The provider threads `domain` / `apiUrl` through every underlying SDK call and accepts both `lel_` and `e2b_` keys (LELANTOS_API_KEY → E2B_API_KEY fallback).
