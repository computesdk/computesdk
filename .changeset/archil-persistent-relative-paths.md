---
"@computesdk/archil": patch
---

Resolve relative paths from `/` for `filesystem.readFile` and `filesystem.writeFile` on persistent VMs, as `mkdir`, `readdir`, `exists` and `remove` already do. The Archil SDK rejects relative paths, so these calls failed outright.
