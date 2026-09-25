---
name: compute-cli
description: Reference for the `compute` CLI published from this repo as @computesdk/cli — command groups (run/providers, actions, bench), provisioned secrets, gotchas, and how to test changes end-to-end.
---

# compute CLI (`@computesdk/cli`, bin: `compute`)

Published on npm from `packages/cli/` in this repo. Any `compute` binary = this package.

## Run it

```bash
pnpm dlx @computesdk/cli <cmd>          # zero-install, latest published
npm i -g @computesdk/cli                # or install once
# in this repo: pnpm build && node packages/cli/dist/index.js <cmd>
```

## Command groups

- `compute run <image> --provider <p>` / `compute providers` — ComputeSDK gateway sandbox runs. Auth: `COMPUTESDK_API_KEY` (Devin org secret, provisioned). Providers take their own creds (e.g. `VERCEL_TOKEN`/`VERCEL_TEAM_ID`/`VERCEL_PROJECT_ID` or `VERCEL_OIDC_TOKEN`; `NSC_TOKEN` or `NSC_TOKEN_FILE`).
- `compute actions <sub>` — benchmarks-platform Actions API (dispatch/runs/run/logs/cancel/rerun/artifacts). See the actions section below.
- `compute bench <args>` — full bench CLI folded in (run/check/auth/org/benchmarks/runs/results/iterations/artifacts/logs/export); dispatched pre-commander to `@benchsdk/runner`'s `run()`.

`--json` machine-readable output is available throughout the actions/bench surface.

## Actions API quick reference

```
compute actions dispatch <repo> --workflow <path|name> [--ref] [--inputs k=v ...] [--manual]
compute actions runs <repo> [--status ...] [--branch ...]
compute actions history <repo> --workflow <path|name> [--branch ...] [--job] [--limit n]
compute actions run <run-id>
compute actions inspect <run-id>
compute actions logs <run-id> [--job] [--step <n|runner>] [--follow]
compute actions cancel|rerun <run-id>
compute actions artifacts <run-id> [--job] [--out <dir>]
```

- Auth envs (Devin org secrets already exist): `COMPUTE_API_KEY` (primary) with `BENCHMARKS_PLATFORM_API_KEY` as legacy fallback — both work; `COMPUTE_PLATFORM_URL`/`BENCHMARKS_PLATFORM_URL` or `--base-url` for the endpoint (default `https://platform.computesdk.com`).
- Bearer key only sent to computesdk.com/localhost unless `--allow-untrusted-host`.
- `--workflow` matches full path, display name, or workflow id — NOT basename.
- `logs --follow` uses resumable byte-offset cursors; reconnects resume from `nextOffset`.
- Registered-workflow repos: `computesdk/ci-test` (Smoke + Conformance 01-12 + Long), `computesdk/benchmarks` (15), `computesdk/benchmarks-ai-gateway-model-index` (26). Live list: `GET /api/v1/actions/workflows?repo=<owner>/<name>`.
- Run dashboard URLs: `{base}/{orgSlug}/actions/runs/{runId}`.

## Testing against a PR preview deployment

benchmarks-platform deploys a Vercel preview per branch (`https://benchmarks-platform-git-<branch>-computesdk.vercel.app`, URL in the Vercel bot comment on the PR). The job executor (`app/api/ci/runs/execute`) is a route in that deployment, so a preview executes the PR's code end-to-end — dispatching at the preview genuinely exercises it.

```bash
PREV="https://benchmarks-platform-git-<branch>-computesdk.vercel.app"
compute actions dispatch computesdk/ci-test --workflow Smoke --ref main \
  --base-url "$PREV" --allow-untrusted-host
```

- `--allow-untrusted-host` is required — the bearer key is only sent to computesdk.com/localhost otherwise.
- The preview shares the production control-plane DB: runs appear in the prod runs table, provider creds and secrets resolve identically, and jobs land on real provider sandboxes.
- `--provider <id>` on dispatch pins placement; a refusal is itself a useful signal (the job's `failureReason` says why).
- Per-job logs: `GET /api/v1/actions/jobs/<jobId>/logs` (`compute actions logs` also works); job ids come from `compute actions run <run-id> --json`.
- Wait for the Vercel check on the PR to be green before dispatching — dispatching during a build can hit the previous deployment.

## Testing CLI changes end-to-end

Cheap live loop (no secrets beyond the org API key, ~50s):

```bash
compute actions dispatch computesdk/ci-test --workflow Smoke --ref main
compute actions logs <run-id> --follow
compute actions run <run-id>
```

## Repo conventions

- vitest tests: `packages/cli/src/__tests__/actions.test.ts` (40 tests) — record-style API fixtures; run `pnpm vitest` in packages/cli.
- Patch-only changesets: add a `.changeset/*.md` with `patch` bumps for touched packages.
- `pnpm install` then `pnpm build` — build order matters (packages/cli builds its deps first).
- Actions API counterpart: `app/api/v1/actions/**` in computesdk/benchmarks-platform.
