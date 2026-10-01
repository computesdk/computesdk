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

1. **Access** — Actions is available to every organization; no subscription or entitlement is required. The free plan includes 5 Actions runs per UTC day; a paid Actions entitlement (Settings → Billing) removes the daily cap.
2. **Connect a repo** — either install the platform's GitHub App (grants repo access + push/PR triggers), or connect a generic git remote by clone URL from **Actions → Repos** or `compute actions repos connect <clone-url>` (`token`, `basic`, `ssh`, and unauthenticated remotes are supported). A connect validates the remote with a real `ls-remote`, then lands enabled.
3. **Register a provider credential** — under **Settings → Providers**, or `compute actions providers configure <provider> --key <key>`. See [Providers and eligibility](#providers-and-eligibility).
4. **Secrets and variables** — optional; see [Secrets and variables](#secrets-and-variables).
5. **Workflows** — repos run ordinary workflow YAML (`.github/workflows/`). Workflows become dispatchable once the repo is enabled and the workflow declares `workflow_dispatch`.

## Providers and eligibility

Provider credentials are bring-your-own: the org stores each provider's key once (encrypted, never readable again), and jobs place on whichever providers the org's **Actions provider order** names — `provider` or `provider:region` entries, walked in order, editable under **Settings → Providers**. Every refusal along the walk is recorded on the job's `placementAttempts`, so a bad key or unsupported region shows up as an explicit reason rather than a silently skipped provider.

```bash
compute actions providers                                 # providers, regions, act-usable status
compute actions providers configure tensorlake --key <key> --verify
compute actions providers configure blaxel --field apiKey=<k> --field workspace=<w>
compute actions providers verify tensorlake               # re-run the placement probe
compute actions providers remove tensorlake               # refused while live boxes need it
```

A stored key makes a provider **placeable**. Actions adds its own eligibility on top:

* **Act-proven** — jobs run under `act`, which needs a real Docker daemon inside the sandbox. Providers with a built-in dockerd path (Vercel, Tensorlake, Blaxel) qualify out of the box; for any other provider, `configure --verify` / `providers verify` proves it by placing a real sandbox and running the same dockerd + act bring-up the job would — a pass marks the org's key act-capable. An unproven provider is *refused* with a recorded reason, not silently skipped.
* **Reconnect-capable for long jobs** — a job whose `timeout-minutes` exceeds one executor invocation can only land on a provider whose sandboxes can be reattached after the invocation ends; shorter jobs don't care.

`dispatch --provider <id>` pins a run to one provider regardless of the stored order (see [Dispatch](#dispatch-and-follow-a-run)).

## Secrets and variables

The org vault holds two kinds of item, set under **Settings → Vault** (org-wide), a repo's **Vault** page (repo overrides), or `compute actions vault`:

* **Secrets** reach workflows as `${{ secrets.NAME }}` and are masked in logs. They are write-only unless created revealable (`--revealable`), which lets owners/admins read them back with `vault get`.
* **Variables** reach workflows as `${{ vars.NAME }}`. They are configuration, not credentials: always readable and not masked.

A repo-level item overrides the org item with the same name. A job only receives the secrets its workflow names (plus `GITHUB_TOKEN`); a workflow that reads secrets dynamically must name them or opt in with `# computesdk:secrets=all`. `compute actions inspect <run-id>` lists the secret names a job was given.

```bash
printf '%s' "$NPM_TOKEN" | compute actions vault set NPM_TOKEN
printf '%s' staging | compute actions vault set DEPLOY_ENV --kind variable --repo myorg/myrepo
compute actions vault ls --repo myorg/myrepo    # includes inherited org items
```

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

## Secrets

Jobs get organization secrets (Settings → Actions) narrowly, not broadly:

* The platform scans each workflow for `secrets.NAME` / `secrets['NAME']` references — in `${{ … }}` expressions and bare `if:` conditions — and passes exactly those names into the job's secrets context. Every other organization secret is withheld. The job log lists which secrets it received and how many were withheld.
* A declared name the organization never configured resolves to an empty string (GitHub parity), so `if: secrets.NAME != ''` feature-detection works; each unconfigured name is noted once in the job log.
* `${{ secrets.GITHUB_TOKEN }}` resolves to an installation token scoped to the repo, carrying what the job's `permissions:` block asked for. Fork pull requests receive no secrets and no token.
* Every log line the job emits — including the executor's own — passes through a mask covering all configured secret values, so a printed secret lands in the stored log as `***`.
* A secret whose stored ciphertext can't be opened fails the job **before** placement with an actionable reason, rather than silently substituting an empty value.

When a workflow reaches the secrets context in a way the scan can't resolve to names — `fromJson(secrets)`, dynamic indexing, a composite action's inputs — declare the access with a comment directive anywhere in the workflow file:

```yaml
# computesdk:secrets=DEPLOY_TOKEN,NPM_TOKEN   # add names to the declared set
# computesdk:secrets=all                    # give the job every organization secret
# computesdk:secrets-env=declared           # also export declared secrets as env vars
```

An expression that reads `secrets` without a literal name (e.g. `secrets[matrix.key]`) is classified `all` automatically — the platform widens rather than hand the job an empty value it can't explain. `# computesdk:secrets=…` is for the cases the file itself doesn't reveal, like secrets consumed inside a composite action. `# computesdk:secrets-env=declared` is for workflows that read `$NAME` directly instead of `${{ secrets.NAME }}`; it exports only configured, declared names and never expands to all secrets.

## GitHub compatibility

Runs GitHub-correctly today:

* `needs:` DAG ordering, `if:` / `failure()` / `always()` / `cancelled()` conditions, `continue-on-error`
* matrix expansion (include/exclude, `matrix.*` context)
* `env`, `$GITHUB_ENV`, `$GITHUB_PATH`, `$GITHUB_OUTPUT`, step outputs, cross-job `needs.*.outputs`
* `concurrency` including `cancel-in-progress`, job/step `timeout-minutes`
* `workflow_dispatch` inputs, third-party `uses:` actions, check-run reporting, cancel/rerun
* `container:` pins — act pulls and runs the image through a reachable Docker daemon on every supported provider; a provider with no daemon refuses the job with a recorded reason
* `secrets.*` expressions resolve against the job's declared secret scope; missing org secrets resolve to an empty string (see [Secrets](#secrets))
* `actions/checkout` `fetch-depth` (other checkout inputs are not yet threaded)

Refused before placement, by design: `services:`, reusable-workflow calls (`jobs.<id>.uses`), `environment:`, non-literal `container:`.

Log retention: the end-of-job drain caps at 8MiB — backlog past that is dropped and the log notes the truncation.
