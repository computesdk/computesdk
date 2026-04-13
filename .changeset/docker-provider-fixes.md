---
"@computesdk/docker": patch
---

Fix build failures and improve container lifecycle:

- Add missing `@computesdk/provider` dependency (was imported but never declared in package.json)
- Fix `runCommand` signature to accept `RunCommandOptions` instead of `string[]`
- Use `exec sleep infinity` for keepalive so PID 1 handles signals
- Replace slow `stop + force remove` with instant `kill + remove`
