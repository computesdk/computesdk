---
"@computesdk/beam": patch
---

Route `filesystem.writeFile`/`readFile` through Beam's native `sandbox.fs.writeText`/`readText` instead of embedding the base64 payload in a shell command, which failed with `fork/exec /usr/bin/sh: argument list too long` for files over ~100 KiB.
