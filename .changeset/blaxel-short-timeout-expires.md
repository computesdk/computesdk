---
"@computesdk/blaxel": patch
---

A sandbox `timeout` under 5 minutes is now sent to Blaxel as an absolute `expires` date instead of being raised to the 5m ttl minimum, so the sandbox ends when the caller asked. Timeouts of 5 minutes or more, preview ttls and a `ttl` passed through provider options are unchanged.
