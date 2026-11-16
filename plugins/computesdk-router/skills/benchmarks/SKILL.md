---
name: benchmarks
description: Read ComputeSDK benchmark results — list benchmarks, runs and per-provider results, reliability and uptime, per-iteration latencies and worker logs. Use when the user asks how sandbox providers compare, how a benchmark run went, or for a provider's reliability.
---

# ComputeSDK benchmarks (read-only)

Benchmarks measure sandbox providers on speed and reliability. In chat they are
read-only: creating, archiving, pausing and re-running benchmarks happens in the
dashboard or the `compute bench` CLI.

## Workflow

1. `benchmarks_list` — benchmarks the org can read, with run counts. Entries
   marked `locked: true` are catalog benchmarks the org isn't entitled to yet.
2. `benchmarks_list_runs` — runs of one benchmark, newest first. Narrow with
   `participants`, `since`/`until` (with `timeZone` for date-only bounds).
3. `benchmarks_get_results` (several runs) or `benchmarks_get_run_results` (one
   run) — success rates and latency p50/p95/p99 per participant. Latency covers
   successful tasks only: report success rate beside it.
4. `benchmarks_get_run_iterations` — per-iteration rows, where outlier tasks show.
5. `benchmarks_get_reliability` — uptime and missed slots for a reliability benchmark.
6. `benchmarks_get_participant_logs` — one participant's worker logs for a run.
   Lines are capped to protect context: raise `maxLines` or narrow with `workerId`.

## Rules

- Compare providers on the same benchmark and the same date range only.
- Quote numbers from the tool output, with their units (ms, percent).
- Never print, echo, or write secrets, including any that appear in logs.
