---
description: >-
  The ComputeSDK Platform REST API surface — every /api/v1 endpoint for
  Actions, the vault, benchmarks, organizations, and the org feed.
---

# API reference

Base URL: `https://platform.computesdk.com/api/v1`. Authenticate every request with `Authorization: Bearer <org API key>` (see [Authentication](README.md#authentication)). Errors are `{ "error": "<message>" }` with a `400`/`401`/`403`/`404`/`410`/`429`/`500` status.

## Identity and organizations

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/me` | Authenticated user + their organizations |
| GET | `/organizations` | List organizations |
| GET/PATCH/DELETE | `/organizations/{orgId}` | Organization detail, update, delete |
| GET/POST | `/organizations/{orgId}/api-keys` | List / create org API keys (owner/admin) |
| DELETE | `/organizations/{orgId}/api-keys/{keyId}` | Revoke a key |
| GET | `/organizations/{orgId}/logo` | Organization logo |
| GET | `/organizations/{orgId}/benchmark-artifacts/{artifactId}` | Org-scoped benchmark artifact download |
| GET | `/feed` | The org's activity feed |

## Actions (CI)

Actions is available to every organization — no product entitlement required. See [Actions](actions.md) for semantics.

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/actions/org` | The org's Actions context |
| GET/POST/PATCH | `/actions/repos` | Connected repos — list, connect a git remote, enable/disable (GitHub App + generic remotes) |
| GET | `/actions/providers` | Registered providers — regions, act/usable status |
| PUT/DELETE | `/actions/providers/{provider}/key` | Save / remove the org's provider credential |
| POST | `/actions/providers/{provider}/verify` | Probe the stored key with a real sandbox |
| GET | `/actions/workflows?repo=` | Workflows on enabled repos (`dispatchable: false` ones run via `manual: true`) |
| POST | `/actions/dispatch` | `{ workflowId, ref, inputs?, manual?, requestId?, provider?, providerRegion? }` → `{ runId, created, headSha }` |
| GET | `/actions/history?repo=&workflow=` | Recent-run window + per-job/step failure rollups |
| GET | `/actions/run-days?timeZone=&repo=&branch=` | Days with runs |
| GET | `/actions/run-states?repo=&branch=` | Live states for the current run list |
| GET | `/actions/runs` | Run list |
| GET | `/actions/runs/day/{YYYY-MM-DD}` | Page of runs for a day (cursor via `nextCursor`) |
| GET | `/actions/runs/{runId}` | Run detail |
| GET | `/actions/runs/{runId}/state` | Conclusion, job placement, step states, effective context |
| GET | `/actions/runs/{runId}/summary` | Failure digest with redacted log tails |
| GET | `/actions/runs/{runId}/stream` | SSE: run state + log bytes (`?watch=id:jobId:step:offset` to resume) |
| POST | `/actions/runs/{runId}/cancel` | Cancel → `{ cancelled }` |
| POST | `/actions/runs/{runId}/rerun` | Rerun same commit → `{ runId, created }` |
| GET | `/actions/jobs/{jobId}/logs` | `CiLogSlice` (`segments`, `nextOffset`, `state`, `totalBytes`); `?follow=1` for SSE |
| GET | `/actions/jobs/{jobId}/logs/download` | Whole log as `text/plain` |
| GET | `/actions/jobs/{jobId}/artifacts` | Job's artifacts |
| GET | `/actions/jobs/{jobId}/artifacts/{artifactId}` | Redirect to signed download URL (`410` when expired) |

## Vault (secrets and variables)

Owner/admin keys only. Not gated on the Actions entitlement. `repo=<owner>/<name>` scopes to a repo's overrides; `kind` is `secret` (default) or `variable`.

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/vault?repo=&kind=` | List items — names and metadata, never values (with `repo`, includes inherited org items) |
| PUT | `/vault?repo=` | `{ name, kind?, value, description?, revealable?, labels?, expectedVersion? }` — value stored exactly as sent; `revealable`/`labels` fixed at creation |
| DELETE | `/vault?repo=&kind=&name=` | Delete an item |
| POST | `/vault/reveal?repo=` | `{ name, kind? }` → `{ name, kind, value }` — variables and revealable secrets only (`403` otherwise, `404` when absent) |

## Benchmarks

Org keys see their own benchmarks plus subscribed (entitled) ones — never other orgs' private definitions. Foreign-but-entitled benchmarks are addressed via `/benchmarks/~/{sourceOrgSlug}/{benchmarkSlug}`.

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/benchmarks` | List visible benchmarks (`limit`/`offset`, max 500) |
| GET/PUT/PATCH | `/benchmarks/{slug}` | Benchmark detail, create/update definition |
| GET | `/benchmarks/{slug}/results` | Latest published results |
| GET | `/benchmarks/{slug}/branding` | Benchmark branding |
| GET | `/benchmarks/{slug}/model-index` | Model index |
| GET | `/benchmarks/{slug}/runs` | Run list; `/runs/days`, `/runs/day/{day}`, `/runs/summary` for rollups |
| GET/POST | `/benchmarks/{slug}/runs` | List / create runs |
| GET | `/benchmarks/{slug}/runs/{runId}` | Run detail |
| GET | `/benchmarks/{slug}/runs/{runId}/summary` | Run summary |
| GET | `/benchmarks/{slug}/runs/{runId}/progress` | Live progress |
| GET | `/benchmarks/{slug}/runs/{runId}/iterations` | Per-iteration data |
| GET | `/benchmarks/{slug}/runs/{runId}/artifacts` | Run artifacts |
| GET/POST | `/benchmarks/{slug}/runs/{runId}/results` | Aggregated results |
| GET | `.../results/timeline`, `.../results/tasks`, `.../results/imports` | Result provenance |
| GET/POST | `/benchmarks/{slug}/runs/{runId}/participants` | Participants under test |
| GET | `.../participants/{slug}` · `.../participants/{slug}/logs` · `.../participants/{slug}/workers` · `.../workers/claim` | Participant state, logs, and worker fleet |
| GET/POST | `.../runs/{runId}/workers/{workerId}` · `/events` · `/heartbeat` · `/complete` · `/fail` · `/release` · `/artifacts` | Worker lifecycle — for benchmark executors |


