---
"@computesdk/superserve": patch
"@computesdk/tensorlake": patch
---

Resolve relative `filesystem.*` paths to an absolute workdir before calling the provider's filesystem API (which requires absolute paths). Relative paths now resolve against the sandbox's exec cwd — falling back to `$HOME` on Tensorlake when the cwd isn't writable — matching what `runCommand` execs see. `.` and duplicate slashes normalize; `..` is preserved for physical resolution.
