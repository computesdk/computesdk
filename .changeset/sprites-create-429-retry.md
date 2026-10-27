---
"@computesdk/sprites": patch
---

Retry sandbox create on HTTP 429 honoring the body's retry_after_seconds — payg-tier accounts are creation rate-limited (10/min) and transient throttling should not surface as a create failure.
