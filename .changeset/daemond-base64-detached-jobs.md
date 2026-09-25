---
"daemond": patch
---

Add `argvEncoding: "base64"` to `daemonSeedScriptCommand` so the seed launcher can be delivered through exec layers that re-split or collapse quotes, and add detached jobs (`exec` with `detach: true`) with `wait`/`status`/`kill` messages. Command results now carry `status: "running" | "exited"`, report `exitCode: null` instead of an invented code while running or when killed by a signal, and `kill` signals the whole process group.
