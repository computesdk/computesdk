---
description: >-
  ComputeSDK Actions is a CI/workflow engine that runs GitHub-style workflow
  YAML through the ComputeSDK router — connect a repository, run workflows,
  inspect logs and artifacts, and rerun failures.
---

# Actions

Actions runs your supported GitHub Actions workflows through the ComputeSDK router. Connect a repository, enable a workflow, then run and inspect jobs from the dashboard, CLI or API. ComputeSDK handles compute placement; each job reports where it ran alongside its steps, logs and result.

## Setup

1. **Connect a repository** — install the ComputeSDK GitHub App and select a repository to enable push and pull-request triggers. You can also connect a git remote under **Actions → Repos** or with `compute actions repos connect <clone-url>`.
2. **Add a workflow** — save a YAML file in `.computesdk/workflows/`, commit it and push it to your repository. Enable the discovered workflow in Actions. Existing `.github/workflows/` files are also supported.
3. **Run and inspect** — push a change or [dispatch a run](#dispatch-and-follow-a-run), follow the logs, and inspect the result. Add any workflow credentials under [Secrets and variables](#secrets-and-variables).

Actions is available to every organization. Workflow runs use compute at the applicable rates; see [pricing](https://www.computesdk.com/pricing).

## Your first workflow

Create `.computesdk/workflows/hello.yml` in your repository:

```yaml
name: Hello ComputeSDK
on:
  workflow_dispatch:
    inputs:
      message:
        description: Message to print
        type: string
        default: Hello from ComputeSDK
permissions:
  contents: read
jobs:
  hello:
    runs-on: ubuntu-latest
    timeout-minutes: 5
    steps:
      - uses: actions/checkout@v4
      - name: Print a message
        env:
          MESSAGE: ${{ inputs.message }}
        run: printf '%s\n' "$MESSAGE"
```

Commit and push the file to `main` (or use your branch in `--ref`). Once the
connected repository discovers it, run it from **Actions** in the dashboard,
or use the CLI:

```bash
compute actions workflows myorg/myrepo
compute actions workflows enable myorg/myrepo .computesdk/workflows/hello.yml
compute actions dispatch myorg/myrepo --workflow .computesdk/workflows/hello.yml --ref main --inputs message="Hello from ComputeSDK"
```

Replace `myorg/myrepo` with your repository. Use the returned run ID to follow
the logs and inspect the result:

```bash
compute actions logs <run-id> --follow
compute actions summary <run-id>
```

ComputeSDK provisions compute for the job and releases it when the job ends.
You do not need to create or destroy a sandbox yourself.

### Workflow file locations

Use **`.computesdk/workflows/` for workflows you want ComputeSDK to run**.
Files directly inside this directory can use `.yml` or `.yaml` extensions.
They use supported GitHub Actions YAML syntax; no wrapper file is required.

ComputeSDK also discovers `.github/workflows/`, so you can run an existing
workflow without moving it. GitHub independently runs eligible files in that
folder too. Keeping a workflow in `.computesdk/workflows/` lets ComputeSDK own
its execution without also scheduling it in GitHub Actions.

If both directories contain a file with the same filename, ComputeSDK uses the
one in `.computesdk/workflows/`. For example, its `hello.yml` takes precedence
over `.github/workflows/hello.yml`; the discovered workflow reports the
shadowed path. This precedence only affects ComputeSDK's discovery, not GitHub.

### Read the YAML

| Field | Meaning |
| --- | --- |
| `name` | Workflow display name |
| `on` | Events that start a run; `workflow_dispatch` enables dashboard and CLI dispatch |
| `on.workflow_dispatch.inputs` | Named inputs for a manual run, passed with `--inputs name=value` |
| `permissions` | Repository token permissions requested by the workflow |
| `jobs` | Named jobs; use `needs` to order dependent jobs |
| `runs-on` | Runner environment label; ComputeSDK chooses the underlying provider unless pinned |
| `timeout-minutes` | Maximum job duration |
| `steps` | Ordered commands (`run`) or actions (`uses`) |
| `env` | Environment variables for a workflow, job or step |
| `${{ inputs.message }}` | An expression reading a dispatch input |

Use `run: |` for a multi-line script. `uses: actions/checkout@v4` checks out
the repository before commands that need its files. Put credentials in
[secrets](#secrets-and-variables), then reference `${{ secrets.NAME }}`.
See [GitHub compatibility](#github-compatibility) for supported features and
current limitations.

### Run on pushes, pull requests or a schedule

Replace or extend the workflow's `on` section with the events you need:

```yaml
on:
  push:
    branches: [main]
  pull_request:
    branches: [main]
  schedule:
    - cron: '0 9 * * 1-5'
  workflow_dispatch:
```

The schedule above runs at 09:00 UTC on weekdays. Commit the workflow to the
watched branch and keep the repository and workflow enabled. Push and
pull-request events require the connected GitHub App. `workflow_dispatch`
keeps an on-demand entry point alongside automatic triggers.

## Providers and eligibility

Actions uses your organization's Actions router to place jobs on available compute. You do not need a provider account to get started with managed compute. To review available providers and placement settings:

```bash
compute actions providers
```

Let ComputeSDK route, set provider and region preferences, or pin a run with `dispatch --provider <id>`. Jobs that cannot be placed report the reason in their run details. Long-running jobs require a provider that supports reconnecting to the sandbox.

For optional BYOK, account modes and billing, see [Routing and BYOK](../guides/routing.md). Actions has its own saved routing configuration, separate from interactive sandboxes.

### Choose compute in YAML

Start with `runs-on: ubuntu-latest` and let the organization's Actions router
choose compute. To pin one job, add a `computesdk:<provider>` placement label:

```yaml
jobs:
  hello:
    runs-on: [ubuntu-latest, 'computesdk:modal']
    steps:
      - run: echo hello
```

Use `computesdk:<provider>:<region>` when you also need a specific region. A
provider pin restricts placement to that provider; it does not fall back to
other providers. Choose a provider eligible for Actions with
`compute actions providers`. For a whole manually dispatched run, use
`--provider <id>` instead of changing the YAML.

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
compute actions summary <run-id>
compute actions rerun <run-id>
```

`--workflow` matches the workflow's file path, display name, or id. Workflows without `workflow_dispatch` are refused unless you pass `--manual`, which runs the workflow anyway; such a run has no inputs, so `--inputs` is rejected for it (a `workflow_dispatch` workflow keeps its inputs with or without `--manual`). `dispatch --provider <id>` pins placement to one provider — a refusal is recorded as the job's `failureReason`, which is itself a useful signal when evaluating providers.

`POST /api/v1/actions/dispatch` accepts `{ workflowId, ref, inputs?, manual?, requestId?, provider?, providerRegion? }`. `manual: true` runs a workflow that doesn't declare `workflow_dispatch` (no inputs). `requestId` dedupes dispatch and rerun.

## Reading runs

* `compute actions runs <repo>` / `GET /api/v1/actions/runs*` — recent runs, pageable by day (`run-days`, `runs/day/{YYYY-MM-DD}`) with cursor fields carried from `nextCursor`
* `compute actions schedule` / `GET /api/v1/actions/schedule` — actual runs plus upcoming scheduled fires in a bounded window. `--from`/`--to` default to now through seven days later (maximum 45 days); `--tz` defaults to the local IANA timezone. Reliability activity is hidden by default; `--reliability` shows only reliability runs and workflows. Filter with `--repo`, repeatable `--workflow` file paths, `--event`, and `--status` conclusions (status filters exclude upcoming fires). `--limit`/`--cursor` paginate past runs, default 100 and maximum 500 per page. Human output shows times, workflow/repo, cron descriptions, event/status, capped-fire `+N more` summaries and a next-page command preserving the window and filters. Reuse the same credentials; the hint never prints API keys. `--json` returns the full response with daily totals, occurrence counts and truncation flags.
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
* `container:` pins — run jobs in the specified container image on providers that support it; unsupported placement reports a reason
* `secrets.*` expressions resolve against the job's declared secret scope; missing org secrets resolve to an empty string (see [Secrets](#secrets))
* `actions/checkout` `fetch-depth` (other checkout inputs are not yet threaded)

Refused before placement, by design: `services:`, reusable-workflow calls (`jobs.<id>.uses`), `environment:`, non-literal `container:`.

Log retention: the end-of-job drain caps at 8MiB — backlog past that is dropped and the log notes the truncation.
