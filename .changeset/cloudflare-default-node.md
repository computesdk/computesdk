---
"@computesdk/cloudflare": patch
---

Restore Node.js in the bridge Worker's `default` container image (base `node:24-trixie-slim` instead of `debian:trixie-slim`) so sandboxes created without an explicit `image` get a Node runtime again.
