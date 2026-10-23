---
description: >-
  Managed benchmarks on the ComputeSDK Platform — org-private and subscribed
  benchmark runs over the REST API and `compute bench` CLI.
---

# Benchmarks

The platform runs managed benchmarks — multi-phase workloads like **Dax** (clone, install, typecheck) — against registered compute, storage, browser, and AI gateway providers, and publishes the results to each organization's feed. Org benchmarks are private by default; categorized benchmark categories can be subscribed to, which entitles your org to run and read those benchmarks as well.

## What a run looks like

A **benchmark** is a workload definition owned by an organization. A **run** is one execution of it against a set of **participants** (the providers or models under test). Each participant's work is carried out by **workers**, which emit telemetry events and artifacts; the platform aggregates those into per-run results and composite scores.

## Reading benchmarks over the API

```bash
export COMPUTE_API_KEY="csdk_..."
BASE=https://platform.computesdk.com/api/v1

curl $BASE/benchmarks                      -H "Authorization: Bearer $COMPUTE_API_KEY"
curl $BASE/benchmarks/dax                  -H "Authorization: Bearer $COMPUTE_API_KEY"
curl "$BASE/benchmarks/dax/runs?limit=20"  -H "Authorization: Bearer $COMPUTE_API_KEY"
curl $BASE/benchmarks/dax/runs/<runId>     -H "Authorization: Bearer $COMPUTE_API_KEY"
curl $BASE/benchmarks/dax/runs/<runId>/results \
  -H "Authorization: Bearer $COMPUTE_API_KEY"
```

`GET /api/v1/benchmarks` pages with `limit`/`offset` (max 500) and returns each benchmark with its owner's org slug — subscribers can tell entitled foreign benchmarks from their own.

### Reading another org's entitled benchmarks

Benchmarks you can see but don't own are addressed through the `~` namespace:

```bash
curl $BASE/benchmarks/~/computesdk/dax        -H "Authorization: Bearer $COMPUTE_API_KEY"
curl $BASE/benchmarks/~/computesdk/dax/runs   -H "Authorization: Bearer $COMPUTE_API_KEY"
curl $BASE/benchmarks/~/computesdk/dax/results -H "Authorization: Bearer $COMPUTE_API_KEY"
```

### Filtering runs and results

`GET /benchmarks/{slug}/runs` and `GET /benchmarks/{slug}/results` take a shared filter:

* `participant` — comma-separated slugs; only runs they took part in, and only their rows
* `since` / `until` — `YYYY-MM-DD` or an ISO timestamp, on run creation time (a date-only `until` is inclusive of that day)
* `timeZone` — IANA zone for date-only bounds, default `UTC`
* `steps` — results only; comma-separated step names or `all` for per-step overviews

```bash
# Runs e2b took part in since Oct 16
curl "$BASE/benchmarks/dax/runs?participant=e2b&since=2026-10-16" \
  -H "Authorization: Bearer $COMPUTE_API_KEY"

# One participant's per-step results
curl "$BASE/benchmarks/dax/results?participant=e2b&steps=create,install" \
  -H "Authorization: Bearer $COMPUTE_API_KEY"
```

Filtered responses echo the applied values back in a `filter` field, so a client can tell the server understood the filter.

### Runs, participants, and workers

Within a run:

* `runs/{runId}/participants` — the providers/models under test and their per-participant state
* `runs/{runId}/participants/{slug}/logs` — participant-level logs
* `runs/{runId}/iterations` and `runs/{runId}/progress` — progress and per-iteration data
* `runs/{runId}/workers/*` — the worker fleet: events, heartbeats, artifacts, completion. (These are primarily for benchmark executors driving a run, not consumers.)
* `runs/{runId}/results`, `results/timeline`, `results/imports`, `results/tasks` — the aggregated output and how it was produced
* `runs/{runId}/summary`, `runs/summary`, `runs/day/{day}`, `runs/days` — rollups and day-scoped history

`GET /api/v1/feed` returns the org's feed — the same activity stream the dashboard shows.

## `compute bench`

Everything above is also reachable through the bench half of the CLI:

```bash
compute bench benchmarks     # list
compute bench runs           # list runs
compute bench results        # query results
compute bench iterations     # per-iteration data
compute bench artifacts      # download run artifacts
compute bench logs           # run logs
compute bench export         # export results
compute bench run            # execute a run
compute bench check          # validate a benchmark definition
```

`runs` and `results` take the same filters as the API:

```bash
compute bench results dax --participant e2b --steps all --since 7d
compute bench runs list dax --participant e2b --day 2026-10-22 --tz America/Los_Angeles
compute bench logs dax <runId> --participant e2b
```

See the [CLI reference](cli.md#compute-bench--the-benchmarks-toolchain) for auth and flags.

## Running benchmarks in your own Actions

The public benchmarks are a scoreboard — but you can also run the same workloads privately in your own org's Actions while you iterate on your infrastructure. Three ways, from lightest to heaviest:

### Fork a catalog benchmark

`bench fork` creates a private benchmark in your org that tracks the upstream definition:

```bash
compute bench fork dax                      # as `dax`, tracking upstream
compute bench fork dax --as dax-myinfra     # your own slug
compute bench fork dax --ref <sha>          # pin instead of tracking
compute bench fork dax --source-org myorg   # fork a different org's benchmark
```

The fork is a normal org benchmark — private to your org — with `config.upstream` recording what it was forked from. It stays private; upstream knows nothing about it.

Then run it like any benchmark, in a workflow on your own copy of the source repo:

```bash
bench run benchmarks/sandbox/dax.bench.ts --benchmark dax-myinfra --provider yourslug
```

Runs execute in *your* Actions. Only participants whose credentials are present in your environment activate — with just your own provider key, only your participant runs. When a run is created inside an Actions job, the bench client reports `ciRunId` (the `COMPUTESDK_RUN_ID` env var) back to the platform, so `GET /api/v1/benchmarks/{slug}/runs/{runId}` returns an `actionRun` link to the producing Actions run for callers in your org.

### Your own copy of the benchmarks repo

Clone [computesdk/benchmarks](https://github.com/computesdk/benchmarks), edit provider configs or parameters, and dispatch the repo's workflow on your branch — the same workflow runs against your private benchmark. No upstream PR needed.

### Net-new benchmarks

Write your own `.bench.ts` file plus a workflow in any repo you control. `PUT /api/v1/benchmarks/{slug}` registers it under your org; runs land on your private benchmark page exactly like catalog runs. See the `writing-benchmarks` skill in computesdk/benchmarks for the authoring walkthrough.

## Log masking in Actions runs

Workflow logs are redacted before storage: secret values, provider keys, and git credentials are masked even across chunk boundaries. A step can register additional mask values at runtime with `::add-mask::<value>` (or the `##[add-mask]<value>` annotation form) — values minted mid-run like presigned URLs or short-lived tokens:

```yaml
- run: |
    TOKEN=$(vault token create -policy=short -ttl=30m -format=json | jq -r .auth.client_token)
    echo "::add-mask::$TOKEN"
    # $TOKEN is masked in every log line from here on
```
