---
"@computesdk/e2b": patch
"@computesdk/hopx": patch
---

Forward `RunCommandOptions.timeout` to the underlying command APIs

- `@computesdk/e2b`: pass `timeoutMs` to `sandbox.commands.run()`.
- `@computesdk/hopx`: pass `timeout` (in seconds) to `sandbox.commands.run()`.
