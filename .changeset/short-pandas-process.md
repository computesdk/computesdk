---
"daemond": patch
"@computesdk/provider": patch
"computesdk": patch
"@computesdk/test-utils": patch
---

Add `sandbox.startProcess()` for interactive long-running processes: daemond gains stdin-capable detached jobs (`stdin`/`closeStdin` messages, bounded output buffers, `command.stdin.closed` events), and the provider factory implements `startProcess` once for all providers.
