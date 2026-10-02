Title: Delegate miosa provider transport to @miosa/sdk's SOMA runner client

Body:

Implements the last step of ONE-HOP-RUNNER-DESIGN-2026-10-02.md section 6
("ComputeSDK provider: one last PR to delegate transport to this package")
and RUNNER-CONTRACTS-2026-10-02.md C5/C6, both in the miosa repo's
tasks/soma-speed/.

What changes:
- `sandbox.create`, `runCommand`, and `sandbox.destroy` route through
  `@miosa/sdk`'s `RunnerClient` (`run-<region>.miosa.ai`) instead of the
  control plane, whenever the API key carries a region segment
  (`msk_<region>_...`) or the caller opts in via the new `runnerMode` config
  field (or `MIOSA_RUNNER_MODE` env var). An explicit `runnerMode: false`
  always wins over a region-tagged key.
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

Blocked on: `@miosa/sdk` has not published a version containing
`RunnerClient` (npm tops out at 3.2.5; the runner module is still on
feat/sdk-soma-runner, PR #213, unreleased). This package's
`dependencies."@miosa/sdk"` is pinned to `^3.3.0` in anticipation, so
`pnpm install` cannot resolve it yet - that is why this PR stays unopened
until the SDK publishes.

The `msk_<region>_...` key format is also still under review upstream (it
has to coexist with the existing single-letter purpose codes - `msk_u_`/
`msk_a_`/`msk_p_` - in that same segment). This provider's eligibility
check matches `@miosa/sdk`'s `KNOWN_RUNNER_REGIONS` allowlist rather than
guessing at the key's shape, so it follows whatever format lands there
without needing a second change here.

Testing: new `src/__tests__/runner-transport.test.ts` mocks `@miosa/sdk`
via `vi.mock` (the module need not exist on disk for this) and covers
eligibility (region tag, explicit opt-in/opt-out, the `msk_test_...`
fixture-key false-positive this would otherwise cause), create/exec/destroy
over the mocked RunnerClient, and that list/getUrl still hit the control
plane for a region-tagged key. All 49 package tests pass (16 new + 29
pre-existing + 4 http2-pool), `tsc --noEmit`, `tsup` build, and `eslint`
all pass clean.
