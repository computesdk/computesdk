---
"@computesdk/modal": patch
---

Fall back to a stdin-fed shell write in filesystem.writeFile when Sandbox.open is unsupported (V2 / scalable sandboxes), and stop trimming content in the shell-backed readFile fallback.
