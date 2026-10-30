---
"@computesdk/miosa": patch
---

Account-API filesystem calls (read/write/mkdir/readdir/remove) now replay 404s through a fresh sandbox's boot window instead of racing it. The control plane's `wait: true` create can still return before the VM finishes booting and `/sandboxes/:id/fs/*` answers 404 until the sandbox attaches; a 404 on a sandbox past the window still surfaces immediately as a genuine miss.
