---
"@computesdk/modal": patch
---

Use Sandbox.filesystem readText/writeText for filesystem.readFile/writeFile so they work on V2 (scalable) sandboxes, where the deprecated Sandbox.open is unsupported.
