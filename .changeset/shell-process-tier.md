---
"@computesdk/provider": patch
"computesdk": patch
"@computesdk/test-utils": patch
---

Background processes and streaming `runCommand` now default to a POSIX-shell process tier built on the provider's plain `runCommand` (no Node, daemon or download; works on Alpine/busybox). Order: provider-native `streamCommand`/`startProcess` hooks, then the shell tier, then daemond only with `processRuntime: 'daemond'`. Adds the `startProcess` provider hook, `instance.processRuntime`, `instance.attachProcess(jobId)`, and process-runtime coverage in the test-utils conformance suite.
