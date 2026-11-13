---
"@computesdk/kosa8": minor
---

Send requests over one HTTP/2 session per origin, opened when the provider is configured (and to a sandbox's host when it is created), instead of a TLS connection per request; `fetch` remains the fallback.
