---
"@computesdk/modal": patch
---

Route filesystem operations through Modal's Sandbox.filesystem API (readText/writeText/makeDirectory/listFiles/stat/remove) so they work on V2 (scalable) sandboxes, where the deprecated Sandbox.open and shell-backed fallbacks are unreliable.
