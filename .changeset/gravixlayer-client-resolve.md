---
"@computesdk/gravixlayer": patch
---

Resolve a provider config object once in `getClient` — repeated calls on the same provider instance skip option resolution entirely, while instances with equivalent options still share one client and its session pool.
