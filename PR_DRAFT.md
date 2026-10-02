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

Known gap: `RunnerClient.exec`'s options (`cwd`/`env`/`timeout`) have no
`wait`/`wait_timeout_ms` knob yet, so the synchronous-readiness-wait
semantics `runCommand` relies on today are not preserved on the runner path
until that type grows or soma-api's runner `/exec` defaults to a
synchronous wait on its own. Flagged in a code comment at the call site.

Blocked on: `@miosa/sdk` has not published a version containing
`RunnerClient` (npm tops out at 3.2.5; the runner module is still on
feat/sdk-soma-runner, PR #213, unreleased). This package's
`dependencies."@miosa/sdk"` is pinned to `^3.3.0` in anticipation, so
`pnpm install` cannot resolve it yet - that is why this PR stays unopened
until the SDK publishes.

Testing: new `src/__tests__/runner-transport.test.ts` mocks `@miosa/sdk`
via `vi.mock` (the module need not exist on disk for this) and covers
eligibility (region tag, explicit opt-in/opt-out, the `msk_test_...`
fixture-key false-positive this would otherwise cause), create/exec/destroy
over the mocked RunnerClient, and that list/getUrl still hit the control
plane for a region-tagged key. All 49 package tests pass (16 new + 29
pre-existing + 4 http2-pool), `tsc --noEmit`, `tsup` build, and `eslint`
all pass clean.
