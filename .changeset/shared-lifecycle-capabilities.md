---
'computesdk': patch
'@computesdk/provider': patch
'@computesdk/test-utils': patch
---

Snapshot capabilities can say what happens to the source (`kept`, `stopped`, `destroyed`), which paths a restore leaves out, whether one snapshot forks into many instances, and whether it needs `snapshot.waitUntilReady()` before restoring. Providers can declare a lifetime (`provider.sandbox.lifetime`) and expose `instance.extendLifetime()`. The conformance suite runs the pause and snapshot tests whenever a provider declares them, and its pause test keeps its probe process alive with `startProcess`.
