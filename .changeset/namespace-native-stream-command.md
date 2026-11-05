---
"@computesdk/namespace": patch
---

Add native `streamCommand` using Namespace's server-streaming `CommandService/RunCommand` (Connect JSON envelopes), so streaming `runCommand` (`onStdout`/`onStderr`) no longer falls back to the daemond bootstrap. Honors `timeout` (`Connect-Timeout-Ms` + client abort, exit 124), `cwd`, `env`, and `background`; a dropped stream keeps streamed output and reports exit `-1`.
