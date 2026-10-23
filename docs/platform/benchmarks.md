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
