---
'@computesdk/codesandbox': patch
---

Fix `snapshot.create` calling `sandbox.hibernate()` on the resumed `Sandbox` instance — `@codesandbox/sdk` exposes hibernate on the `Sandboxes` manager, so it now calls `sdk.sandboxes.hibernate(sandboxId)`. Previously threw `sandbox.hibernate is not a function`.
