---
"@computesdk/kernel": patch
---

Map `keepAlive: true` to Kernel's inactivity timeout. Kernel has no keep-alive flag; a disconnected browser stays in standby until `timeout_seconds` elapses, and the API default is 60 s, so `keepAlive` was silently dropped and keep-alive sessions were deleted a minute after the client disconnected. Without an explicit `timeout`, `keepAlive: true` now sets `timeout_seconds` to 3600. An explicit `timeout` still wins. Standby browsers incur no usage charges.
