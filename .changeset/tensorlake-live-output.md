---
"@computesdk/provider": patch
"@computesdk/tensorlake": patch
---

Stream a Tensorlake command's output while it runs. Providers can now implement `streamCommand` to serve `onStdout`/`onStderr` over their own API instead of the daemond SSE bridge, which needs a routable port inside the sandbox; Tensorlake does so by following the process, so a long-running command reports line by line rather than only at exit.
