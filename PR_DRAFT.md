Title: Delegate miosa provider transport to @miosa/sdk's SOMA runner client

Body:

Implements the last step of ONE-HOP-RUNNER-DESIGN-2026-10-02.md section 6
("ComputeSDK provider: one last PR to delegate transport to this package")
and RUNNER-CONTRACTS-2026-10-02.md C5/C6, both in the miosa repo's
tasks/soma-speed/.

What changes:
- `sandbox.create`, `runCommand`, and `sandbox.destroy` route through
  `@miosa/sdk`'s `RunnerClient` (`run-<region>.miosa.ai`) instead of the
  control plane, whenever the caller opts in via the new `runnerMode`
  config field (or `MIOSA_RUNNER_MODE` env var). No API key carries a
  region this release (C5 decision, 2026-10-02), so there is no key-based
  eligibility - `runnerMode` is the only way in, and the region defaults
  to `us`.
- Every other operation - `list`, `getById`, `getInfo`, `getUrl`/expose,
  `filesystem.*`, `snapshot.*` - keeps using the control-plane transport
  unchanged: `RunnerClient` does not expose those routes yet, and
  expose/snapshots are staying on the control plane for now regardless
  (design doc section 5.5).
- Routing eligibility is decided once (at `create`/`getById`/`list` time)
  and carried on the sandbox handle, since later per-sandbox operations only
  ever receive the handle, not the original config.
- New `MiosaConfig` fields: `runnerMode?: boolean`, `runnerBaseDomain?:
  string` (self-hosted/test override for `miosa.ai`). Both optional and
  additive; the public surface is otherwise unchanged.

On `wait`/`wait_timeout_ms`: `runCommand` builds those into the
control-plane request body to cap a synchronous readiness wait, but never
forwards them to `RunnerClient.exec` (whose options are `cwd`/`env`/
`timeout` only - no wait knob). This is intentional, not a gap: on the
runner, `create` only answers once the launch has completed (state
"running", C2), so by the time `exec` runs there is nothing left to wait
for. No `@miosa/sdk` type change needed.

Depends on `@miosa/sdk@^3.3.0` (published; exports `RunnerClient`). The
ambient type shim is gone, the real types are used.

Testing: new `src/__tests__/runner-transport.test.ts` mocks `@miosa/sdk`
via `vi.mock` (the module need not exist on disk for this) and covers
eligibility (default stays on the control plane, `runnerMode: true`,
`MIOSA_RUNNER_MODE=1`, an explicit `runnerMode: false` overriding the env
var, `runnerBaseDomain`), create/exec/destroy over the mocked RunnerClient,
and that list/getUrl still hit the control plane even with `runnerMode:
true`. All 48 package tests pass (15 new + 29 pre-existing + 4
http2-pool), `tsc --noEmit`, `tsup` build, and `eslint` all pass clean.
