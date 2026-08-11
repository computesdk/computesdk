---
"@computesdk/test-utils": patch
---

Add a shared live-output suite to the provider tests. A provider opting in with `supportsStreaming: true` is checked against its real sandbox for output arriving before the command exits, streamed text matching the final `stdout` exactly, stderr staying separate with a non-zero exit, and a streaming command being stopped at its timeout — so streaming becomes a conformance property rather than something each provider tests its own way. Enabled for tensorlake and tenki.
