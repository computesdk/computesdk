---
"@computesdk/daytona": patch
---

Upgrade `@daytonaio/sdk` to `^0.192.0` and migrate off the deprecated offset-based sandbox pagination (the `page` param and `/api/sandbox/paginated` endpoint, retired by Daytona on 2026-07-02). `sandbox.list()` now consumes the auto-paginating async iterator returned by `daytona.list()`, and the snapshot/template methods use the renamed `daytona.snapshot` accessor.
