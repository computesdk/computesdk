---
description: >-
  The ComputeSDK Platform is the hosted sandbox router and CI router: place
  sandboxes across your providers or the compute market, run GitHub Actions
  workflows on real compute providers, and drive it all from the CLI, REST API
  or MCP.
---

# ComputeSDK Platform

## What the platform is

The ComputeSDK Platform ([platform.computesdk.com](https://platform.computesdk.com)) is the hosted control plane for ComputeSDK. The open-source SDK gives you one sandbox API across providers. The platform decides where work runs and tracks it for you:

* **[Sandboxes](sandboxes.md), the sandbox router.** Create sandboxes through one endpoint and let the platform place them. It follows your `providerOrder`, using your own provider keys, the compute market, or both, with optional price limits.
* **[Actions](actions.md), the CI router.** Run GitHub-style workflows on real compute providers instead of fixed runner VMs. Each job is placed by your org's provider order and reports the `provider:region` it ran on.
* **[Benchmarks](benchmarks.md).** Managed runs that measure providers and publish results to your org's feed.

Everything the platform does is available four ways:

* the web dashboard at `https://platform.computesdk.com/<org-slug>/...`
* the `compute` CLI (`@computesdk/cli` on npm)
* the REST API under `https://platform.computesdk.com/api/v1`
* the MCP server at `https://platform.computesdk.com/mcp` — for AI assistants (ChatGPT, Claude, Codex). Connects over OAuth; tools cover sandboxes, Actions runs, provider keys, and benchmark results, using the same data as the REST routes.

## Organizations

Work is organized into **organizations**. Signing up at the platform creates your personal org; every sandbox, connected repo, provider credential, Actions run, benchmark run, and API key belongs to an organization, and every API call resolves to exactly one org — resources in another org are indistinguishable from nonexistent ones (the API returns `404`).

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

The `compute` CLI can also authenticate interactively — `compute login` (equivalently `compute bench auth login`, or `bench auth login` from `@benchsdk/runner`) runs the platform's OAuth device flow and stores tokens in `~/.benchsdk/credentials.json`, which `compute bench`, `compute actions`, `compute market`, and `compute sandboxes` then use (refreshing expired access tokens automatically). An env var key always wins over stored credentials.

## Products and entitlements

Platform features are gated by per-org **product entitlements**:

* **Actions** is free for every org — connected repos, dispatch, and the `/api/v1/actions/*` API work out of the box.
* Benchmark categories (compute, storage, browser, AI gateway) unlock benchmark runs in that category

Billing is managed under **Settings → Billing** (`/<org-slug>/settings/billing`). Unentitled API calls return `403`.

## Error model

API errors use a single envelope:

```json
{ "error": "<message>" }
```

with status `400`, `401`, `403`, `404`, `410`, `429`, or `500`. Successful responses are wrapped as `{ "ok": true, ... }`-style JSON payloads.

## Where next

* [Sandboxes](sandboxes.md) — create and route hosted sandboxes from code
* [Actions](actions.md) — connect repos, register provider credentials, dispatch workflows, stream logs
* [CLI reference](cli.md) — install and drive the `compute` CLI
* [MCP server](mcp.md) — connect Claude, ChatGPT and other assistants
* [Benchmarks](benchmarks.md) — benchmarks, runs, and results over the API
* [API reference](api-reference.md) — the full `/api/v1` endpoint surface
