---
"@computesdk/miosa": patch
---

Declare Miosa snapshot listing as instance-scoped so callers can discover its required owner ID and unscoped requests reject before authentication or native calls. Preserve the existing sandbox-scoped endpoint and support both canonical `instanceId` and legacy `sandboxId` options.
