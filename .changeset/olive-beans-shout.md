---
"@computesdk/tensorlake": patch
"@computesdk/sandbox0": patch
---

tensorlake: default `runCommand`/`streamCommand` cwd to the writable workdir already probed for filesystem paths — the sandbox default cwd is `/`, which isn't writable, so relative-path commands (e.g. `mkdir bench-rootfs`) failed with EACCES.

sandbox0: retry `sandbox.cmd` context creation on the transient "runtime access is not ready for this generation" response (and retryable 429/5xx), bounded by the command deadline — a claimed sandbox can race its runtime coming up.
