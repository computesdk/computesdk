---
"@computesdk/modal": patch
---

Default image is now `node:22` (ships `node:sqlite`), `destroy()` waits for the sandbox to exit so mounted Volume writes are committed before the next mount, and `runCommand` env applies to every part of a compound command.
