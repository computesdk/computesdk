---
"@computesdk/daytona": patch
---

Reject missing child completion metadata even when the native wrapper reports success.

Missing or malformed native status no longer defaults to zero. Explicit native failures remain available when the child delimiter is absent; valid in-band child status still takes precedence. Protocol failures expose a safe `DaytonaCommandProtocolError` without captured output.
