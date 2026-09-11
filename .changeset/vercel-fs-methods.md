---
"@computesdk/vercel": patch
---

Route mkdir/readdir/exists/remove through `sandbox.fs`. `mkdir` now creates parent directories (the raw `Sandbox.mkDir` API is non-recursive and failed with "error creating directory: No such file or directory" for nested paths), and `readdir`/`exists`/`remove` are implemented instead of throwing "not supported".
