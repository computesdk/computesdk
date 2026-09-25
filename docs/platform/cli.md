---
description: >-
  Install and use the `compute` CLI (@computesdk/cli) to drive the ComputeSDK
  Platform — Actions dispatch, run logs, artifacts, provider credentials,
  connected repos, and the bench toolchain — plus one-off sandbox runs.
---

# CLI reference

## Install

```bash
pnpm dlx @computesdk/cli <cmd>   # zero-install, always latest
npm i -g @computesdk/cli         # or install once
```

The binary is `compute`. Pass `--json` on almost any platform command for machine-readable output.

## Authentication

Auth resolves in this order: `COMPUTE_API_KEY` env var → `BENCHMARKS_PLATFORM_API_KEY` (legacy) → stored credentials (`~/.computesdk/credentials.json`, written by the browser login flow). The bearer key is only sent to `computesdk.com` and `localhost` unless you pass `--allow-untrusted-host`.

```bash
export COMPUTE_API_KEY="csdk_..."
compute actions runs myorg/myrepo
```

`--base-url` (or `COMPUTE_PLATFORM_URL` / `BENCHMARKS_PLATFORM_URL`) selects a different platform deployment. Default: `https://platform.computesdk.com`.

## `compute actions` — drive CI on the platform

```bash
# See what you can run
compute actions repos                          # org's connected repos
compute actions repos connect <clone-url>      # connect a generic git remote
compute actions repos enable <owner>/<repo>    # enable / disable scheduling
compute actions repos disable <owner>/<repo>

# Provider credentials (owner/admin key required)
compute actions providers                      # registered providers, regions, status
compute actions providers configure <provider> # save the org's credential
compute actions providers verify <provider>    # probe it with a real sandbox
compute actions providers remove <provider>

# Dispatch and follow runs
compute actions dispatch <repo> --workflow <path|name> [--ref] [--inputs k=v ...]
compute actions runs <repo> [--status ...] [--branch ...]
compute actions history <repo> --workflow <path|name> [--branch] [--job] [--limit n]
compute actions run <run-id>                   # jobs, provider:region placement
compute actions summary <run-id>               # failure digest, redacted log tails
compute actions inspect <run-id>               # resolved image, caches, secrets, concurrency
compute actions logs <run-id> [--job] [--step <n|runner>] [--follow]
compute actions cancel <run-id>
compute actions rerun <run-id>
compute actions artifacts <run-id> [--job] [--out <dir>]
```

Notes:

* `--workflow` matches the full file path, the display name, or the workflow id — not the basename.
* `logs --follow` is resumable: it tracks byte offsets, so a reconnect picks up where it left off.
* `history` is how you tell a new failure from a flaky one — it reports per-job and per-step failure rates over a window of recent runs.
* Run dashboard URLs look like `https://platform.computesdk.com/<org>/actions/runs/<runId>`.

## `compute bench` — the benchmarks toolchain

`compute bench` folds the full `@benchsdk/runner` bench binary under `compute`:

```bash
compute bench auth          # browser login / credential management
compute bench org           # organization info
compute bench benchmarks    # list benchmarks
compute bench runs          # list runs
compute bench results       # query results
compute bench iterations    # per-iteration data
compute bench artifacts     # download run artifacts
compute bench logs          # run logs
compute bench export        # export results
compute bench run           # execute a benchmark run
compute bench check         # validate a benchmark definition
```

## `compute run` / `compute providers` — one-off sandboxes

```bash
compute providers                        # list gateway providers
compute run <image> --provider <name>    # start a sandbox via the ComputeSDK gateway
```

`compute run` authenticates with `COMPUTESDK_API_KEY` (the gateway key — different from the platform key). Each provider reads its own credentials from env vars; see the [provider docs](../providers/README.md).
