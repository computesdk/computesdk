---
"@computesdk/modal": patch
---

Await `process.stdout.readText()`, `process.stderr.readText()`, and `process.wait()` in parallel inside `runCommand` and filesystem ops (`readFile` cat-fallback, `mkdir`, `readdir`, `remove`), removing a serial round trip per exec.
