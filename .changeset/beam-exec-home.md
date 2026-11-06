---
"@computesdk/beam": patch
---

`runCommand` sets `HOME` from the running user's passwd entry when Beam's exec environment leaves it unset, so `$HOME`, `~` and tools that keep state there work.
