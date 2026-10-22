---
'@computesdk/miosa': minor
---

Route sandbox create, exec and destroy through MIOSA's regional sandbox endpoint by default to cut client round-trip latency. A create falls back to the account API only when the regional endpoint provably refused it before provisioning anything, and is never sent a second time after a request that may have been delivered. Opt out with `runnerMode: false` or `MIOSA_RUNNER_MODE=0`.

Add an opt-in `lazyCreate` option (`MIOSA_LAZY_CREATE=1`): `create()` returns without a network call and the first `runCommand()` creates the sandbox and runs the command in one request.

Load the runner client from `@miosa/sdk/runner` when the installed SDK has that entry (falling back to the root entry), and leave the account API connection pool closed until a call first goes there while the regional endpoint is in use.

Regional routing is on by default only against MIOSA's own account API: a provider with a custom `baseUrl` or `MIOSA_BASE_URL` stays on that control plane and never sends its key to the public regional endpoint, unless `runnerMode: true`, `MIOSA_RUNNER_MODE=1` or a `runnerBaseDomain` asks for it.
