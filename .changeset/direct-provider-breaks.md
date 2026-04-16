---
"computesdk": minor
"@computesdk/provider": minor
"@computesdk/railway": minor
"@computesdk/render": minor
"@computesdk/workbench": minor
---

Remove hosted control-plane assumptions from `computesdk` and move to direct provider mode.

### `computesdk`

- Remove gateway/control-plane transport from `compute`; `compute.sandbox.*` now routes directly to configured provider instances.
- Replace legacy config pathways with direct provider configuration only:
  - `compute.setConfig({ provider })`
  - `compute.setConfig({ providers: [...] })`
- Add multi-provider routing support with:
  - `provider` + `providers` support
  - `providerStrategy` (`priority` / `round-robin`)
  - `fallbackOnError`
  - per-call provider override (`{ provider: 'name' }`)
- Remove legacy hosted/gateway modules and exports (`auto-detect`, `explicit-config`, provider env/config exports).
- Replace provider compatibility tests with direct-provider contract tests and new CI integration coverage.

### `@computesdk/provider`

- Remove deprecated `defineCompute` and compute-factory exports that depended on hosted control-plane behavior.
- Keep direct provider APIs (`defineProvider`, `createCompute`, `defineInfraProvider`).

### `@computesdk/railway` and `@computesdk/render`

- Remove control-plane compute wrapper behavior.
- Package entrypoints now throw explicit migration errors explaining that these wrappers are no longer supported after control-plane removal.

### `@computesdk/workbench`

- Remove dependency on deleted `computesdk` provider config exports.
- Inline provider env/auth metadata and switch compute instantiation to direct provider instances in both mode paths.
- This preserves workbench mode UX while removing legacy control-plane config usage.

### Migration Notes

- Stop using legacy config shapes such as provider-name strings with control-plane keys.
- Configure `computesdk` with provider instances from provider packages.
- For infrastructure packages previously used as control-plane wrappers (`@computesdk/railway`, `@computesdk/render`), migrate to supported direct provider packages.
