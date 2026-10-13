---
"@computesdk/modal": patch
"@computesdk/vercel": patch
"@computesdk/declaw": patch
"@computesdk/tensorlake": patch
"@computesdk/beam": patch
"@computesdk/upstash": patch
"@computesdk/daytona": patch
"@computesdk/codesandbox": patch
"@computesdk/sprites": patch
---

Fix `runCommand` contract violations found by the sandbox CI capabilities benchmark:

- **Timeout dropped**: modal, vercel, declaw, and tensorlake never forwarded `options.timeout` to the underlying SDK (`timeoutMs`/`timeout` fields). Beam has no native timeout option, so the adapter now kills the process when the deadline passes.
- **Merged stdout/stderr**: daytona, codesandbox, and sprites only expose one combined output stream; the adapters now redirect stderr to a temp file and parse it back behind a delimiter so `stderr` is populated correctly. Upstash already returns `stderr` — the adapter now forwards it.
- **Exit code collapsed**: codesandbox hardcoded `exitCode: 0`; it now captures the real exit code in-band.
