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

## BYOK providers

The providers an org brings its own key for, shared by Actions and sandboxes. Reads are open to members; writes need an owner/admin. Ambient providers (platform-keyed) aren't listed and answer 400.

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/providers` | Every BYOK provider: key state (masked hint, never the key), `rate`, `customRate`, `platformRate` |
| GET | `/providers/{provider}` | One provider |
| PUT/DELETE | `/providers/{provider}/key` | Save / remove the org's credential |
| POST | `/providers/{provider}/verify` | Probe the stored key with a real sandbox |
| PUT/DELETE | `/providers/{provider}/rate` | Set / clear the org's custom rate (`{ usd, per }`) — cost reporting only, never billing |

## Actions (CI)

Actions is available to every organization — no product entitlement required. See [Actions](actions.md) for semantics.

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/actions/org` | The org's Actions context |
| GET/POST/PATCH | `/actions/repos` | Connected repos — list, connect a git remote, enable/disable (GitHub App + generic remotes) |
| GET | `/actions/providers` | Where Actions can place — regions, order, act/usable status, key status |
| GET/PATCH | `/actions/routing` | Read / change the saved [managed and BYOK router](#routing) (owner/admin) |
| PUT/DELETE | `/actions/providers/{provider}/key` | Deprecated alias of `/providers/{provider}/key` |
| POST | `/actions/providers/{provider}/verify` | Deprecated alias of `/providers/{provider}/verify` |
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

## Routing

Sandboxes and Actions have separate saved routers. `GET`/`PATCH /sandboxes/routing` and `GET`/`PATCH /actions/routing` use the same contract. Both methods accept an org API key or an owner/admin user credential; OAuth credentials also need the product's read scope for GET or write scope for PATCH, plus `org:admin`.

GET and successful PATCH return:

| Field | Meaning |
| --- | --- |
| `strategy` | `computesdk` (recommended order, the default), `cheapest` (price order for the size), or `custom` |
| `routing` | Custom managed order, or `"default"` for either non-custom strategy; use `strategy` to distinguish them |
| `managed` | Effective live managed accounts in order for `size` |
| `size` | Preview size: `medium` for Sandboxes, `xlarge` for Actions |
| `available` | Live managed accounts a custom order may name |
| `byok.mode` | `off` (managed only), `first` (own keys first), `fallback` (own keys after managed), or `only` (own keys only) |
| `byok.order` | Effective own-key order, as `provider[:region]` entries |
| `byok.inherits` | Sandboxes only: whether its empty BYOK order inherits Actions' order |

PATCH requires at least one of `routing`, `byok`, or `byokOrder`:

| Field | Accepted values |
| --- | --- |
| `routing` | `"computesdk"` (`"default"` is an alias), `"cheapest"`, or an array of live managed account names selecting `custom` |
| `byok` | `"off"`, `"first"`, `"fallback"`, or `"only"` |
| `byokOrder` | Array of the org's own `provider[:region]` preferences, subject to the product's settings validation |

```bash
curl https://platform.computesdk.com/api/v1/sandboxes/routing \
  -H "Authorization: Bearer $COMPUTE_API_KEY" \
  -H 'Content-Type: application/json' \
  -X PATCH -d '{"routing":"cheapest","byok":"fallback"}'
```

Read `available` before saving a custom managed order. Unlisted accounts are excluded; `routing: []` selects an empty custom managed order. An account that is not live returns `400` with `Not a managed account: …`. Switching to `computesdk` or `cheapest` preserves the stored custom order. Sandboxes `byokOrder: []` resumes inheritance from Actions.

The saved router applies to plain sandbox creates and Actions jobs using the org's order. Explicit provider orders and provider pins bypass it. Resource overrides and pool floors use the separate `/sandboxes/settings` and `/actions/settings` endpoints.

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

**Filtering.** `GET /benchmarks/{slug}/runs`, `GET /benchmarks/{slug}/results`, and their `~/` variants accept these query params; filtered responses echo the normalized values back in a top-level `filter` object:

- `participant` — comma-separated participant slugs. Only runs that participant took part in, and only that participant's rows (max 20).
- `since` / `until` — bounds on run creation time. `YYYY-MM-DD` or an ISO 8601 timestamp; a date-only `since` means the start of that day and `until` is inclusive of that day, both resolved in `timeZone` (IANA name, default `UTC`).
- `steps` — comma-separated step names or `all` (results only; passing it to `/runs` is a `400`). Adds per-step overviews to each run.

`/results` paginates by run: `limit` (default 25, max 100) and `offset`. `/runs` takes `limit` (max 500, no default) and `offset`.

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/benchmarks` | List visible benchmarks (`limit`/`offset`, max 500) |
| GET/PUT/PATCH | `/benchmarks/{slug}` | Benchmark detail, create/update definition |
| GET | `/benchmarks/{slug}/results` | Per-run results overview — task counts, success rate, p50/p95/p99 latency (filters above) |
| GET | `/benchmarks/{slug}/branding` | Benchmark branding |
| GET | `/benchmarks/{slug}/model-index` | Model index |
| GET | `/benchmarks/{slug}/runs` | Run list (filters above); `/runs/days`, `/runs/day/{day}`, `/runs/summary` for rollups |
| GET/POST | `/benchmarks/{slug}/runs` | List / create runs |
| GET | `/benchmarks/{slug}/runs/{runId}` | Run detail — includes `actionRun: {id, dashboardUrl}` for the owning org when the run was produced by an Actions job |
| POST | `/benchmarks/{slug}/runs/{runId}/run-again` | Run the benchmark again on the latest code (409 when Run again is off) |
| GET | `/benchmarks/{slug}/run-again/{runAgainId}` | Poll for the benchmark run ID |
| GET | `/benchmarks/{slug}/runs/{runId}/summary` | Run summary |
| GET | `/benchmarks/{slug}/runs/{runId}/progress` | Live progress |
| GET | `/benchmarks/{slug}/runs/{runId}/iterations` | Per-iteration data |
| GET | `/benchmarks/{slug}/runs/{runId}/artifacts` | Run artifacts |
| GET/POST | `/benchmarks/{slug}/runs/{runId}/results` | Aggregated results |
| GET | `.../results/timeline`, `.../results/tasks`, `.../results/imports` | Result provenance |
| GET/POST | `/benchmarks/{slug}/runs/{runId}/participants` | Participants under test |
| GET | `.../participants/{slug}` · `.../participants/{slug}/logs` · `.../participants/{slug}/workers` · `.../workers/claim` | Participant state, logs, and worker fleet |
| GET/POST | `.../runs/{runId}/workers/{workerId}` · `/events` · `/heartbeat` · `/complete` · `/fail` · `/release` · `/artifacts` | Worker lifecycle — for benchmark executors |

**Notable fields.** `GET /benchmarks/{slug}` returns `source` — the platform's source descriptor for the bench file (`{githubOwner, repo, ref, path}`). `POST /runs` accepts `ciRunId` (a `ci_runs` id owned by the same org, e.g. `COMPUTESDK_RUN_ID` inside an Actions job) to link the benchmark run to its producing Actions run.

