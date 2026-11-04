---
"@computesdk/codesandbox": patch
---

Dispose only the native connection opened by each completed SDK command or filesystem operation. Preserve operation errors and caller-owned raw native connections, and prevent completed operations from leaving auto-reconnecting sessions behind.
