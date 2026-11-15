---
'@computesdk/briq': patch
---

Update `@briq-cloud/sdk` to 0.2.0. Synchronous finite foreground commands (no stdout/stderr callbacks, timeout 1–60 s) now run directly against the briq's regional origin when the API grants scoped access, falling back to the central API only when that access is unavailable. Passing a custom `fetch` keeps all commands on the central API.
