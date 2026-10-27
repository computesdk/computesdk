---
"@computesdk/namespace": patch
---

Honor `runCommand`'s `options.timeout` server-side. The Namespace CommandService runs each `RunCommandSync` call inside a single RPC, so the caller's timeout is now sent as the Connect `Connect-Timeout-Ms` deadline header — the server aborts the command when it expires instead of the request running away. A client-side abort at timeout + 10s remains as a fallback if the server ignores the deadline. Previously `options.timeout` was accepted but silently ignored.
