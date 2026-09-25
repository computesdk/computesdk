---
description: >-
  The ComputeSDK Platform is the hosted control plane for ComputeSDK: managed
  Benchmarks, Actions CI on real compute providers, organizations, and a
  REST API + CLI for driving all of it.
---

# ComputeSDK Platform

## What the platform is

The ComputeSDK Platform ([platform.computesdk.com](https://platform.computesdk.com)) is the hosted control plane behind ComputeSDK. Where the open-source SDK gives you a provider-agnostic sandbox API, the platform runs and tracks workloads for you:

* **Benchmarks** — managed benchmark runs that measure sandbox, storage, browser, and AI gateway providers and publish reproducible results to your org's feed
* **Actions** — a CI/workflow engine that executes GitHub-style workflows on real compute providers, not fixed runner VMs

Everything the platform does is available three ways:

* the web dashboard at `https://platform.computesdk.com/<org-slug>/...`
* the `compute` CLI (`@computesdk/cli` on npm)
* the REST API under `https://platform.computesdk.com/api/v1`

## Organizations

Work is organized into **organizations**. Signing up at the platform creates your personal org; every benchmark run, connected repo, provider credential, and API key belongs to an organization, and every API call resolves to exactly one org — resources in another org are indistinguishable from nonexistent ones (the API returns `404`).

Org members collaborate through the dashboard. Owners and admins manage API keys, provider credentials, and connected repositories under **Settings** (`/<org-slug>/settings`).

## Authentication

The REST API and CLI authenticate with **organization API keys**:

1. Open **Settings → API keys** (`/<org-slug>/settings/api-keys`) in the dashboard
2. Create a key — the full value is shown once, store it somewhere safe
3. Pass it as a bearer token

```bash
export COMPUTE_API_KEY="csdk_..."

curl https://platform.computesdk.com/api/v1/me \
  -H "Authorization: Bearer $COMPUTE_API_KEY"
```

The key implies the organization — no org id is needed on normal calls. `BENCHMARKS_PLATFORM_API_KEY` is accepted as a legacy fallback env var. Pointing at a different deployment (e.g. a preview) is done with `COMPUTE_PLATFORM_URL` / `BENCHMARKS_PLATFORM_URL` or the CLI's `--base-url`.

`GET /api/v1/me` returns the authenticated user and their organizations.

### CLI browser auth

The `compute` CLI can also authenticate interactively — `compute bench auth` (and other commands that need auth) run a browser flow against `console.computesdk.com` and store the resulting key in `~/.computesdk/credentials.json`. An env var key always wins over stored credentials.

## Products and entitlements

Platform features are gated by per-org **product entitlements**:

* Benchmark categories (compute, storage, browser, AI gateway) unlock benchmark runs in that category
* The **Actions** product subscription unlocks the entire Actions surface — dashboards, connected repos, dispatch, and the `/api/v1/actions/*` API — for every org member

Billing is managed under **Settings → Billing** (`/<org-slug>/settings/billing`). Unentitled API calls return `403`.

## Error model

API errors use a single envelope:

```json
{ "error": "<message>" }
```

with status `400`, `401`, `403`, `404`, `410`, `429`, or `500`. Successful responses are wrapped as `{ "ok": true, ... }`-style JSON payloads.

## Where next

* [CLI reference](cli.md) — install and drive the `compute` CLI
* [Actions](actions.md) — connect repos, register provider credentials, dispatch workflows, stream logs
* [Benchmarks](benchmarks.md) — benchmarks, runs, and results over the API
* [API reference](api-reference.md) — the full `/api/v1` endpoint surface
