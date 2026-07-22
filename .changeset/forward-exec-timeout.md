---
"@computesdk/createos-sandbox": patch
---

Forward timeout to createos-sandbox exec requests

The `runCommand` method now passes `options.timeout` as `timeoutMs` to the underlying `@nodeops-createos/sandbox` exec call. Previously the timeout was ignored and the SDK used a hardcoded 60s default, causing long-running commands (e.g. dax benchmark) to time out.
