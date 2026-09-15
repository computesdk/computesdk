---
"@computesdk/namespace": patch
---

Implement `sandbox.filesystem` methods for Namespace using `runCommand`. This fixes filesystem benchmarks and workloads that call `mkdir`, `writeFile`, `readFile`, and `exists` on Namespace sandboxes.

File writes are base64-encoded and split into commands that stay under typical shell argument length limits. `writeFile` is chunked on 48,000-character base64 boundaries so each `runCommand` stays safe for 100 KiB payloads.
