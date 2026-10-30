---
"@computesdk/miosa": patch
---

Route filesystem methods over exec for regionally-created sandboxes. The account API answers 404 for a regional sandbox's `/sandboxes/:id/fs` routes and the regional endpoint exposes no fs routes, so `readFile`/`writeFile`/`mkdir`/`readdir`/`remove` now compose over `runCommand` when the sandbox's recorded transport is regional, and fall back to exec when an unrecorded handle's fs call 404s.
