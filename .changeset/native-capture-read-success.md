---
"@computesdk/modal": patch
"@computesdk/isorun": patch
"@computesdk/createos-sandbox": patch
"@computesdk/sandbox0": patch
"@computesdk/microsandbox": patch
---

Require successful native file reads before accepting captured command output, byte counts, or child exit status.

A failed native `cat` can no longer masquerade as valid zero-byte output or supply plausible metadata. Runtime-invalid native results fail with safe command-integrity diagnostics. Successful empty output, completed nonzero child commands, and explicitly best-effort timeout output retain their existing behavior.
