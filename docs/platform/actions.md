---
description: >-
  ComputeSDK Actions is a CI/workflow engine that runs GitHub-style workflow
  YAML on real compute-provider sandboxes — connect repos, register provider
  credentials, dispatch runs, and stream logs from the dashboard, CLI, or API.
---

# Actions

Actions is the platform's CI engine: it runs workflow files — the same GitHub Actions syntax your repo already uses — inside managed sandboxes on the compute providers your organization registers, instead of on fixed hosted runners.

Jobs execute under [`act`](https://github.com/nektos/act) inside a ComputeSDK sandbox, so every job lands on a real provider and reports its `provider:region` placement alongside its steps.

## Setup

1. **Entitlement** — Actions requires the Actions product subscription (Settings → Billing). Unentitled orgs get `403` from every `/api/v1/actions/*` route.
2. **Connect a repo** — either install the platform's GitHub App (grants repo access + push/PR triggers), or connect a generic git remote by clone URL from **Actions → Repos** or `compute actions repos connect <clone-url>` (`token`, `basic`, `ssh`, and unauthenticated remotes are supported). A connect validates the remote with a real `ls-remote`, then lands enabled.
3. **Register a provider credential** — under **Settings → Providers**, or `compute actions providers configure <provider>`. `verify` probes the stored key by placing a real sandbox; `providers` lists regions and whether each provider is act-usable.
4. **Workflows** — repos run ordinary workflow YAML (`.github/workflows/`). Workflows become dispatchable once the repo is enabled and the workflow declares `workflow_dispatch`.

## Dispatch and follow a run

```bash
compute actions dispatch myorg/myrepo --workflow ci.yml --ref main --inputs env=staging
compute actions logs <run-id> --follow
compute actions run <run-id>
```

`--workflow` matches the workflow's file path, display name, or id. Workflows without `workflow_dispatch` are refused unless you pass `--manual`, which runs the workflow anyway; such a run has no inputs, so `--inputs` is rejected for it (a `workflow_dispatch` workflow keeps its inputs with or without `--manual`). `dispatch --provider <id>` pins placement to one provider — a refusal is recorded as the job's `failureReason`, which is itself a useful signal when evaluating providers.

`POST /api/v1/actions/dispatch` accepts `{ workflowId, ref, inputs?, manual?, requestId?, provider?, providerRegion? }`. `manual: true` runs a workflow that doesn't declare `workflow_dispatch` (no inputs). `requestId` dedupes dispatch and rerun.

## Reading runs

* `compute actions runs <repo>` / `GET /api/v1/actions/runs*` — recent runs, pageable by day (`run-days`, `runs/day/{YYYY-MM-DD}`) with cursor fields carried from `nextCursor`
* `compute actions run <id>` / `GET .../runs/{runId}/state` — conclusions, job placement, step timings, and the run's effective context: resolved `runs-on` → runner image, `container:` pin, cache keys, bound secret names (never values), concurrency group, per-job `timeout-minutes`/`fetch-depth`, dispatch inputs, provider override
* `compute actions summary <id>` / `GET .../runs/{runId}/summary` — failure digest: every job's conclusion + `provider:region`; failed jobs expand with their failed steps and a bounded, secret-redacted log tail (≤50 lines / ≤8KB)
* `compute actions history <repo> --workflow <w>` / `GET .../history` — a window of recent runs plus per-job and per-step failure rollups. A step that failed 4 of the last 5 runs is flaky, not a regression — check this before "fixing" unbroken code. `failedBeforeSteps` counts runs where the job failed with no step blamed (placement refused, sandbox lost): platform flakiness, not a broken step.

## Logs and artifacts

Logs are **byte-addressed**. Poll `GET /api/v1/actions/jobs/{jobId}/logs?offset=<n>` and resume with the returned `nextOffset`; `step=<ordinal>` restricts to one step, `step=runner` reads output outside every step. `follow=1` (or `compute actions logs --follow`, or the run's SSE stream) turns the same offsets into a stream — a reconnect just reopens with the offsets it holds. `logs/download` returns the whole log as `text/plain`.

`GET .../jobs/{jobId}/artifacts` lists a job's artifacts; `.../artifacts/{artifactId}` redirects to a signed download URL (expired links return `410`).

Cancel and rerun: `compute actions cancel|rerun <run-id>`, or `POST .../runs/{runId}/cancel|rerun`.

## GitHub compatibility

Runs GitHub-correctly today:

* `needs:` DAG ordering, `if:` / `failure()` / `always()` / `cancelled()` conditions, `continue-on-error`
* matrix expansion (include/exclude, `matrix.*` context)
* `env`, `$GITHUB_ENV`, `$GITHUB_PATH`, `$GITHUB_OUTPUT`, step outputs, cross-job `needs.*.outputs`
* `concurrency` including `cancel-in-progress`, job/step `timeout-minutes`
* `workflow_dispatch` inputs, third-party `uses:` actions, check-run reporting, cancel/rerun
* `container:` pins — act pulls and runs the image through a reachable Docker daemon on every supported provider; a provider with no daemon refuses the job with a recorded reason
* missing org secrets resolve to an empty string (matching GitHub), so `if: secrets.NAME != ''` feature-detection works; each unconfigured name is noted once in the job log
* `actions/checkout` `fetch-depth` (other checkout inputs are not yet threaded)

Refused before placement, by design: `services:`, reusable-workflow calls (`jobs.<id>.uses`), `environment:`, non-literal `container:`.

Log retention: the end-of-job drain caps at 8MiB — backlog past that is dropped and the log notes the truncation.
