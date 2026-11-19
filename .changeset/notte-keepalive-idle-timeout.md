---
"@computesdk/notte": patch
---

Map `keepAlive: true` to Notte's idle timeout. Notte has no keep-alive flag; a disconnected session stays open until `idle_timeout_minutes` elapses, and the API default is 3 minutes, so `keepAlive` was silently dropped and keep-alive sessions closed 3 minutes after the client went idle. `keepAlive: true` now sets `idle_timeout_minutes` to the session's max duration (15 minutes by default, or the explicit `timeout`), capped at Notte's 30-minute limit.
