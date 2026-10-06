---
"@computesdk/freestyle": patch
---

Clamp `runCommand` timeouts to Freestyle's 5-minute exec cap. The exec API rejects `timeoutMs` above 300000; a caller carrying a longer deadline (e.g. a job timeout forwarded verbatim) got an API error instead of a run. Timeouts are now clamped to the documented maximum.
