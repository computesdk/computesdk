---
"@computesdk/bench": patch
---

Unify bench SDK read/write configuration around `baseUrl` with sane defaults.

- `createBench({ baseUrl?, apiKey?, ... })`
  - `baseUrl` now defaults to `https://platform.computesdk.com/api/v1`
  - ingest endpoint resolves to `${baseUrl}/events`
- `createBenchQueryClient({ baseUrl?, apiKey? })`
  - now accepts optional config object
  - defaults match `createBench`
- Query methods exposed on `createBench(...)` continue to use the same shared base URL and auth.
