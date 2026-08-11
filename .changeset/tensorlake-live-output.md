---
"@computesdk/provider": patch
"@computesdk/tensorlake": patch
---

Stream a command's output while it runs, over a provider's own process API. Providers can now implement `streamCommand` to serve `onStdout`/`onStderr` themselves instead of using the daemond SSE bridge, which needs a routable port inside the sandbox, and `streamCommandViaProcess` from `@computesdk/provider` does the whole lifecycle for them — deadline, best-effort kill, exit polling and recovering the tail when a follow connection drops — so a provider supplies only its start/follow/status/kill calls. Tensorlake is the first to use it, so a long-running command there reports line by line rather than only at exit.
