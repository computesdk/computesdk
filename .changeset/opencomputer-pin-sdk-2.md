---
'@computesdk/opencomputer': patch
---

Depend on `@opencomputer/sdk` ^2.3.1 instead of `latest`. 3.0.0 changed the SDK's API and the provider doesn't build against it yet; with `latest`, any lockfile update pulled it in.
