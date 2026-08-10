---
'@computesdk/run-cloud': patch
---

Open and close Run Cloud public port URLs through the `@run-cloud/sdk` tunnel API, releasing an expiring tunnel when it is refreshed so long-lived sandboxes stay within the active tunnel limits. Also give the ESM bundle a `createRequire` shim, since bundling the ESM-only SDK inlines `ws` and its CommonJS sources call `require`.
