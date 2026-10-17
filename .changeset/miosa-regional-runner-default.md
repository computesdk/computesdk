---
'@computesdk/miosa': minor
---

Route sandbox create, exec and destroy through MIOSA's regional sandbox endpoint by default to cut client round-trip latency. A create falls back to the account API only when the regional endpoint provably refused it before provisioning anything, and is never sent a second time after a request that may have been delivered. Opt out with `runnerMode: false` or `MIOSA_RUNNER_MODE=0`.

Add an opt-in `lazyCreate` option (`MIOSA_LAZY_CREATE=1`): `create()` returns without a network call and the first `runCommand()` creates the sandbox and runs the command in one request.
