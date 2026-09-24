---
description: >-
  Run GitHub Actions–compatible workflows on ComputeSDK-managed sandboxes with
  Actions, the managed Agent Actions & CI product on the ComputeSDK
  platform.
layout:
  width: default
  title:
    visible: true
  description:
    visible: false
  tableOfContents:
    visible: true
  outline:
    visible: true
  pagination:
    visible: true
  metadata:
    visible: true
  tags:
    visible: true
  actions:
    visible: true
---

# Actions

Actions is the managed Agent Actions & CI product on the [ComputeSDK platform](https://platform.computesdk.com). It runs ordinary GitHub Actions workflow files (`.github/workflows/*.yml`) on ComputeSDK-managed sandboxes: every job executes under [act](https://github.com/nektos/act) inside an isolated sandbox on one of your org's compute providers.

Because jobs run on the same sandbox providers ComputeSDK benchmarks, Actions doubles as a live compatibility surface for every provider — and you can pin a run to any registered provider when you dispatch it.

## Before you begin

* A ComputeSDK platform account and an organization with Actions enabled — sign in at [platform.computesdk.com](https://platform.computesdk.com).
* A GitHub repository containing workflow files you want to run.
* An org API key if you plan to drive Actions from the CLI or REST API — create one under **Settings → API keys**.

## Connect a repository

1. Go to **`/<orgSlug>/settings/actions`** and install the ComputeSDK GitHub App, granting the repositories you want to run Actions on. You can connect more than one GitHub account.
2. Open **Actions → Repos → Add repositories** (`/<orgSlug>/actions/repos/add`) and enable each granted repository. Enabling scans the default branch for `.github/workflows` files and registers every workflow it finds.
3. Repeat the grant in GitHub and click **Sync** on the settings page whenever you grant new repositories to the App.

Once a repo is enabled, the platform keeps its workflow list in sync with the default branch. Push and `pull_request` events arrive over the GitHub App webhook and create runs automatically for workflows that declare those triggers.

## Configure secrets

Workflow `secrets.*` values come from two places:

* **Repo secrets** — the repo's Actions page → **Secrets** (`/<orgSlug>/actions/repos/<owner>/<repo>/secrets`). These are write-only: the UI lists names, never values.
* **Org secrets** — **Settings → Actions**, shared across the org's repos.

A job that references a secret that does not exist fails at pre-flight before the run starts (GitHub substitutes an empty string instead — see [GitHub compatibility](#github-actions-compatibility)).

## Choose providers

Each job is placed on a ComputeSDK sandbox. The org's **placement order** — an ordered list of `provider` or `provider:region` entries under **Settings → Providers** — decides where jobs land, with fallback down the list when a provider refuses a job. Providers that need credentials take bring-your-own keys on the same page.

### Implemented providers

| Provider | Placement id | Credential (Settings → Providers) | Regions |
| -------- | ------------ | --------------------------------- | ------- |
| Vercel | `vercel` | None needed — the platform's own Vercel OIDC credential is used; a stored key is not required | `iad1`, `sfo1`, `cle1`, `cdg1` |
| Tensorlake | `tensorlake` | API key | — (account default) |
| Namespace | `namespace` | API token | — (account default) |
| Archil | `archil` | API key, plus an optional region field (defaults to `aws-us-east-1`) | `aws-us-east-1`, `aws-eu-west-1`, `gcp-us-central1` |
| Blaxel | `blaxel` | API key, plus an optional workspace field | `us-pdx-1`, `us-was-1`, `eu-lon-1`, `eu-fra-1` |

A provider with no key saved (or a saved key that fails verification) still shows up in the placement order — it just refuses every job, and the refusal lands in the run's placement attempts. Naming a region for a provider that has none (Namespace, Tensorlake) is rejected rather than ignored.

You can also pin a single provider (and optionally a region) per dispatch, which replaces the whole placement order for that run — useful for testing a workflow on one provider:

```bash
compute actions dispatch owner/repo --workflow ci.yml --provider namespace
compute actions dispatch owner/repo --workflow ci.yml --provider vercel:sfo1
```

## Run a workflow

Actions supports three trigger paths, matching the workflow's `on:` triggers:

* **Push and pull request** — automatic, via the GitHub App webhook.
* **Manual dispatch** — for workflows declaring `workflow_dispatch`. Use the **Run workflow** button on the Actions page, the CLI, or the API.
* **Schedules** — workflows declaring `on: schedule` fire on their cron expressions and appear under **Actions → Schedules**.

## Use the CLI

`compute actions` (alias `compute ci`) ships in [`@computesdk/cli`](https://www.npmjs.com/package/@computesdk/cli):

```bash
npm i -g @computesdk/cli        # or: pnpm dlx @computesdk/cli <command>
```

Authenticate with an org API key via environment variable (or pass `--api-key`):

| Variable | Required | Purpose |
| -------- | -------- | ------- |
| `COMPUTE_API_KEY` | yes | Org API key used as the bearer credential for the CLI and the v1 API (create one under **Settings → API keys**) |
| `BENCHMARKS_PLATFORM_API_KEY` | no | Legacy name, read as a fallback when `COMPUTE_API_KEY` is unset |
| `COMPUTE_PLATFORM_URL` | no | API base URL override (default `https://platform.computesdk.com`) — same as `--base-url` |
| `BENCHMARKS_PLATFORM_URL` | no | Legacy name, read as a fallback when `COMPUTE_PLATFORM_URL` is unset |

```bash
export COMPUTE_API_KEY=your_org_api_key
```

The bearer key is only sent to computesdk.com and localhost base URLs — point the CLI anywhere else and it refuses unless you also pass `--allow-untrusted-host`. Every command accepts `--json` for machine-readable output.

```bash
# Dispatch a workflow_dispatch run (matches workflow path, name, or id)
compute actions dispatch owner/repo --workflow ci.yml --ref main --inputs suite=smoke

# List recent runs for a repo
compute actions runs owner/repo --status failed --branch main

# Show a run: jobs, provider:region placement, placement attempts
compute actions run <run-id>

# Print or follow a run's logs (all jobs, one job, or one step)
compute actions logs <run-id> --follow
compute actions logs <run-id> --job build --step 3
compute actions logs <run-id> --job build --step runner   # output outside every step

# Cancel or re-run
compute actions cancel <run-id>
compute actions rerun <run-id>

# List or download a run's artifacts
compute actions artifacts <run-id>
compute actions artifacts <run-id> --job build --out ./artifacts
```

Dispatch prints the run's dashboard URL: `https://platform.computesdk.com/<orgSlug>/actions/runs/<runId>`.

## Use the REST API

The same surface is available under `https://platform.computesdk.com/api/v1/actions` for agents and scripts. Send `Authorization: Bearer <org API key>` — the credential determines the org. Errors return `{ "error": "<message>" }` with 400/401/403/404/410/429/500.

| Method | Path | Purpose |
| ------ | ---- | ------- |
| GET | `/workflows?repo=<owner>/<repo>` | List a repo's registered workflows |
| GET | `/runs?repo=&status=&branch=` | Recent runs for a repo |
| GET | `/run-days?timeZone=&repo=&branch=` | Days that have runs |
| GET | `/run-states?repo=&branch=` | Live states for the current run list |
| GET | `/runs/day/{YYYY-MM-DD}?cursorStartedAt=&cursorId=` | Page of runs for one day; carry both cursor fields from `nextCursor` |
| GET | `/runs/{runId}` | A run and its jobs |
| GET | `/runs/{runId}/state` | Conclusion, job placement, step states and timings |
| GET | `/runs/{runId}/stream?watch=...` | SSE stream of run state and log bytes |
| POST | `/dispatch` | `{ workflowId, ref, inputs?, requestId?, provider?, providerRegion? }` → `{ runId, created, headSha }` |
| POST | `/runs/{runId}/cancel` | Cancel a run → `{ cancelled }` |
| POST | `/runs/{runId}/rerun` | Re-run at the same commit → `{ runId, created }` (deduped by `requestId`) |
| GET | `/jobs/{jobId}/logs?offset=&step=` | One log slice: `segments`, `nextOffset`, `state`, `totalBytes` |
| GET | `/jobs/{jobId}/logs?offset=&step=&follow=1` | Same slices over SSE |
| GET | `/jobs/{jobId}/logs/download` | Whole job log as `text/plain` |
| GET | `/jobs/{jobId}/artifacts` | Artifacts produced by a job |
| GET | `/jobs/{jobId}/artifacts/{artifactId}` | Redirect to a signed download URL (410 when expired) |

```ts
const res = await fetch("https://platform.computesdk.com/api/v1/actions/dispatch", {
  method: "POST",
  headers: {
    Authorization: `Bearer ${process.env.COMPUTE_API_KEY}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({ workflowId: "ci.yml", ref: "main", inputs: { suite: "smoke" } }),
});
const { runId } = await res.json();
```

**Resumable logs.** Job logs are byte-addressed: poll `GET /jobs/{jobId}/logs?offset=<n>` and resume with the returned `nextOffset`. The `state` field reports `running`/`complete`/`failed`/`cancelled`/`expired`/`pending`, and `step=<n>` restricts to one step's ordinal (`step=runner` selects output outside every step). SSE is sugar over the same offsets — a reconnect just reopens with the offset it holds.

## Watch runs in the dashboard

The run page — `/<orgSlug>/actions/runs/<runId>` — streams job and step state live, including provider placement, step timings, and a cancel/rerun control. The Actions index (`/<orgSlug>/actions`) lists runs by day with filters for repo, branch, event, status, and workflow.

Artifacts produced by `actions/upload-artifact` appear on the job and are downloadable from the run page, the CLI, or the API until their signed URLs expire.

## GitHub Actions compatibility

Jobs run under act inside managed sandboxes, with injected `Checkout repo@sha`, `Set up the Actions runtime`, `Set up job`, and `Complete job` steps.

**Supported:** `needs:` DAG ordering, job and step `timeout-minutes`, matrix (expand, include, exclude, `matrix.*` context), `if:` / `failure()` / `always()` / `cancelled()`, `continue-on-error`, `concurrency` (including `cancel-in-progress`), `env` / `GITHUB_ENV` / `GITHUB_PATH` / `GITHUB_OUTPUT` / step outputs / cross-job `needs.*.outputs`, `workflow_dispatch` inputs, third-party `uses:` actions, `actions/checkout` `fetch-depth`, artifacts and the Actions cache, check-run reporting, cancel/rerun.

**Refused before a job is placed (by design):** `services:`, reusable-workflow calls (`jobs.<id>.uses`), `environment:`, non-literal `container:`.

**Known divergences:** a missing org/repo secret fails the run at pre-flight instead of substituting an empty string; an end-of-job drain cap can truncate very large logs; `actions/checkout` inputs beyond `fetch-depth` (`submodules`, `lfs`, …) are not yet handled; `workflow_call`, `workflow_run`, `permissions:` enforcement, OIDC, and Windows/macOS runners are not supported.
