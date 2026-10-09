---
"@computesdk/miosa": patch
---

Bound the HTTP/2 connect phase so an unreachable endpoint rejects within the connect timeout (default 10 s, `MIOSA_HTTP2_CONNECT_TIMEOUT_MS`) instead of waiting on the operating system, and clamp the override to Node's maximum timer delay.
