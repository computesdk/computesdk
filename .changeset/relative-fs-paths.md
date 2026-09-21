---
"@computesdk/modal": patch
"@computesdk/createos-sandbox": patch
"@computesdk/sail": patch
---

Accept relative paths in `sandbox.filesystem` operations. Providers whose native file APIs require absolute paths (Modal `filesystem.*`, createos `files.*`, Sail `fs.*`) previously rejected or misrouted relative paths; they are now resolved against the sandbox's exec working directory — probed once via `pwd` and cached — so `filesystem.writeFile('a.txt', ...)` and `runCommand('cat a.txt')` address the same file. Absolute paths skip the probe entirely; `.` segments and duplicate slashes are normalized, while `..` segments are left for the sandbox filesystem to resolve physically.
