---
name: compute-cli
description: Reference for the `compute` CLI published from this repo as @computesdk/cli — command groups (sandboxes, actions, market, providers, bench), one shared login, and how to test changes end-to-end. Full user-facing guides live in computesdk/sandbox-skills (`compute-sandboxes-cli`, `compute-actions-cli`); keep them in sync when the CLI surface changes.
---

# compute CLI (`@computesdk/cli`, bin: `compute`)

Published on npm from `packages/cli/` in this repo. Any `compute` binary = this package. Requires 2.x — if `compute --version` shows 1.0.x, an old standalone binary (`~/.local/bin/compute`) is shadowing the npm install; remove it.

## Run it

```bash
pnpm dlx @computesdk/cli <cmd>          # zero-install, latest published
npm i -g @computesdk/cli                # or install once
# in this repo: pnpm build && node packages/cli/dist/index.js <cmd>
```

## Command groups

- `compute login` / `compute logout` — OAuth device flow (the approval screen shows an org picker); one stored session covers every group below (`sandboxes`, `actions`, `market`, `bench`).
- `compute org list` / `compute org use <slug>` / `compute org current` / `compute whoami` — manage the persisted active org (2.1+). `--org <slug>` or `COMPUTE_ORG` overrides per command; org API keys are tied to one org, so `--org` doesn't apply to them.
- `compute providers` — lists third-party sandbox providers and which credential env vars each needs (e.g. `VERCEL_TOKEN`/`VERCEL_TEAM_ID`/`VERCEL_PROJECT_ID` or `VERCEL_OIDC_TOKEN`; `NSC_TOKEN` or `NSC_TOKEN_FILE`). Local env-var detection only.
- `compute sandboxes|sbx <sub>` — hosted platform sandboxes over `/api/v1/sandboxes` (create/list/get/destroy, exec, spawn/ps/logs/wait/kill/stdin/close-stdin, ls/cat/write/mkdir/rm, url, snapshots/snapshot/snapshot-delete).
- `compute actions|ci <sub>` — benchmarks-platform Actions API (dispatch/runs/history/run/summary/inspect/logs/cancel/rerun/artifacts, providers, repos, vault).
- `compute market <sub>` — sell side of the compute market (asks/bids/fills, provider credential, settlements).
- `compute bench <args>` — full bench CLI folded in; dispatched pre-commander to `@benchsdk/runner`'s `run()`.

`--json` machine-readable output is available throughout the actions/sandboxes/market surface. Full command references: `compute-sandboxes-cli` and `compute-actions-cli` skills in https://github.com/computesdk/sandbox-skills.

## Auth

Resolution order: `--api-key` → `COMPUTE_API_KEY` → `BENCHMARKS_PLATFORM_API_KEY` (legacy) → the stored `compute login` session. Org selection: `--org <slug>` → `COMPUTE_ORG` → the login's persisted org (`compute org use`). `--base-url` or `COMPUTE_PLATFORM_URL`/`BENCHMARKS_PLATFORM_URL` selects the endpoint (default `https://platform.computesdk.com`). The bearer key is only sent to computesdk.com/localhost, and only over HTTPS (plain http for loopback only), unless `--allow-untrusted-host` — which applies to explicit keys only; stored `compute login` credentials are never sent to untrusted hosts (`untrusted_host_stored_auth`). `insufficient_scope`/401 → run `compute login` again.

## Actions quick reference

```
compute actions dispatch <repo> --workflow <path|name> [--ref] [--inputs k=v ...] [--manual]
compute actions runs <repo> [--status ...] [--branch ...]
compute actions history <repo> --workflow <path|name> [--branch ...] [--job] [--limit n]
compute actions run|summary|inspect <run-id>
compute actions logs <run-id> [--job] [--step <n|runner>] [--follow]
compute actions cancel|rerun <run-id>
compute actions artifacts <run-id> [--job] [--out <dir>]
compute actions providers [configure|verify|remove <provider>]
compute actions repos [connect <cloneUrl>|enable|disable <owner/repo>]
compute actions vault ls|set|get|rm [<name>] [--repo owner/repo] [--kind secret|variable]
```

- `--workflow` matches the workflow's full path (`.github/workflows/ci.yml`), display name, or id — a bare basename like `ci.yml` does not resolve.
- `vault set NAME` reads the value from stdin (`printf %s "$V" |`, not `echo`) or `--from-file`, never argv; `--revealable` (secrets, fixed at creation) allows `vault get`. Needs an owner/admin key; API is `/api/v1/vault` in benchmarks-platform.
- `logs --follow` uses resumable byte-offset cursors; reconnects resume from `nextOffset`.
- Registered-workflow repos: `computesdk/ci-test` (Smoke + Conformance 01-12 + Long), `computesdk/benchmarks` (15), `computesdk/benchmarks-ai-gateway-model-index` (26). Live list: `GET /api/v1/actions/workflows?repo=<owner>/<name>`.
- Run dashboard URLs: `{base}/{orgSlug}/actions/runs/{runId}`.

## Sandboxes quick reference

```
compute sandboxes create [--order market,blaxel,vercel] [--label] [--image]
    [--snapshot-id] [--cpus] [--memory-mb] [--disk-mb] [--timeout-ms] [--secret <name>...]
compute sandboxes list|get|destroy
compute sandboxes exec <id> <command...>          # one-off, buffered (~290s max)
compute sandboxes spawn|ps|logs|wait|kill|stdin|close-stdin   # detached processes
# 2.1.1+: flags pass through to the sandbox command — `exec <id> uname -a`,
# `spawn <id> --cwd /app npm run dev`; a bare `--` also works. Unknown leading flags error.
compute sandboxes ls|cat|write|mkdir|rm <id> [path]
compute sandboxes url <id> --port <n>
compute sandboxes snapshots|snapshot|snapshot-delete
```

REST: `POST /api/v1/sandboxes` → `{ sandbox: { id, … } }`; provider order (`provider[:region]`, `market` bids first) resolves per-request `providerOrder` → org sandbox order → Actions order → default; `GET/PATCH /api/v1/sandboxes/settings` holds `providerOrder`/`marketCap`/`providerResources`/`warmPool`; rates at `/api/v1/sandboxes/rates`; pool at `/api/v1/sandboxes/pool/fill`; `GET /api/v1/sandboxes/{id}` returns the BYOK `attach: {provider, providerSandboxId, region}` descriptor (null on market fills/ambient).

## Testing against a PR preview deployment

benchmarks-platform deploys a Vercel preview per branch (`https://benchmarks-platform-git-<branch>-computesdk.vercel.app`, URL in the Vercel bot comment on the PR). The job executor (`app/api/ci/runs/execute`) is a route in that deployment, so a preview executes the PR's code end-to-end — dispatching at the preview genuinely exercises it.

```bash
PREV="https://benchmarks-platform-git-<branch>-computesdk.vercel.app"
compute actions dispatch computesdk/ci-test --workflow Smoke --ref main \
  --base-url "$PREV" --allow-untrusted-host
```

- `--allow-untrusted-host` is required — the bearer key is only sent to computesdk.com/localhost otherwise. It only covers an explicit `--api-key`/`COMPUTE_API_KEY`; stored `compute login` credentials are refused for untrusted hosts (`untrusted_host_stored_auth`).
- The preview has its own Neon branch DB, copied from production when the preview is built: runs dispatched at a preview don't show up in prod (`actions run <id>` returns 404 there). `actions vault set`/`get` refuse non-computesdk.com hosts even with `--allow-untrusted-host`, because a PR author controls the preview's code and could capture the value; test vault changes against localhost instead. Provider creds still resolve and jobs still land on real provider sandboxes.
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
- Actions API counterpart: `app/api/v1/actions/**` in computesdk/benchmarks-platform; Sandboxes API counterpart: `app/api/v1/sandboxes/**`.
