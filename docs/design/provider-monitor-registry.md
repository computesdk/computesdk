# Provider Monitor Registry

This file is the source of truth for which public pages each provider-maintenance agent should monitor.
Each row maps a ComputeSDK provider to the URLs the agent should check for pricing, docs, and API/changelog updates.
When a URL is `TBD`, the agent is expected to discover the authoritative public page via `WebSearch` and update this registry.

| Provider | Category | Pricing URL | Docs URL | API / changelog URL | Last checked | Notes |
|---|---|---|---|---|---|---|
| **E2B** | compute | https://e2b.dev/pricing | https://e2b.dev/docs | https://e2b.dev/docs/api-reference | 2026-07-16 |  |
| **Modal** | compute | https://modal.com/pricing | https://modal.com/docs | https://modal.com/docs/reference | 2026-07-16 |  |
| **Daytona** | compute | https://www.daytona.io/pricing | https://www.daytona.io/docs | TBD | 2026-07-16 |  |
| **Runloop** | compute | https://www.runloop.ai/pricing | https://docs.runloop.ai | TBD | 2026-07-16 |  |
| **Lelantos** | compute | TBD | TBD | TBD | 2026-07-16 | Agent will discover authoritative URLs |
| **Leap0** | compute | TBD | TBD | TBD | 2026-07-16 | Agent will discover authoritative URLs |
| **Declaw** | compute | TBD | TBD | TBD | 2026-07-16 | Agent will discover authoritative URLs |
| **HopX** | compute | TBD | TBD | TBD | 2026-07-16 | Agent will discover authoritative URLs |
| **Beam** | compute | https://beam.cloud/pricing | https://docs.beam.cloud | TBD | 2026-07-16 |  |
| **Superserve** | compute | TBD | TBD | TBD | 2026-07-16 | Agent will discover authoritative URLs |
| **Freestyle** | compute | TBD | TBD | TBD | 2026-07-16 | Agent will discover authoritative URLs |
| **Isorun** | compute | TBD | TBD | TBD | 2026-07-16 | Agent will discover authoritative URLs |
| **CreateOS Sandbox** | compute | TBD | TBD | TBD | 2026-07-16 | Agent will discover authoritative URLs |
| **Tensorlake** | compute | https://tensorlake.ai/pricing | https://docs.tensorlake.ai | TBD | 2026-07-16 |  |
| **Blaxel** | compute | https://www.blaxel.ai/pricing | https://docs.blaxel.ai | TBD | 2026-07-16 |  |
| **CodeSandbox** | compute | https://codesandbox.io/pricing | https://codesandbox.io/docs | TBD | 2026-07-16 |  |
| **Upstash Box** | compute | https://upstash.com/pricing | https://upstash.com/docs | TBD | 2026-07-16 |  |
| **Vercel** | compute | https://vercel.com/pricing | https://vercel.com/docs | TBD | 2026-07-16 |  |
| **Railway** | compute | https://railway.app/pricing | https://docs.railway.app | TBD | 2026-07-16 |  |
| **Cloud Run** | compute | https://cloud.google.com/run/pricing | https://cloud.google.com/run/docs | TBD | 2026-07-16 |  |
| **Cloudflare** | compute | https://developers.cloudflare.com/workers/platform/pricing | https://developers.cloudflare.com/workers | TBD | 2026-07-16 |  |
| **Namespace** | compute | TBD | TBD | TBD | 2026-07-16 | Agent will discover authoritative URLs |
| **Northflank** | compute | https://northflank.com/pricing | https://northflank.com/docs | TBD | 2026-07-16 |  |
| **Collimate** | compute | TBD | TBD | TBD | 2026-07-16 | Agent will discover authoritative URLs |
| **Quilt** | compute | TBD | TBD | TBD | 2026-07-16 | Agent will discover authoritative URLs |
| **Tenki** | compute | TBD | TBD | TBD | 2026-07-16 | Agent will discover authoritative URLs |
| **Agentuity** | compute | https://agentuity.com/pricing | https://docs.agentuity.com | TBD | 2026-07-16 |  |
| **Archil** | compute | TBD | TBD | TBD | 2026-07-16 | Agent will discover authoritative URLs |
| **Sprites** | compute | TBD | TBD | TBD | 2026-07-16 | Agent will discover authoritative URLs |
| **Docker** | compute | https://www.docker.com/pricing | https://docs.docker.com | https://docs.docker.com/engine/api | 2026-07-16 | Self-hosted / local |
| **K8s** | compute | n/a | https://kubernetes.io/docs | https://kubernetes.io/docs/reference | 2026-07-16 | Self-hosted / cluster |
| **AgentCore** | compute | https://aws.amazon.com/bedrock/pricing | https://docs.aws.amazon.com/bedrock/ | TBD | 2026-07-16 |  |
| **anchorbrowser** | browser | TBD | TBD | TBD | 2026-07-16 | Agent will discover authoritative URLs |
| **browserbase** | browser | https://www.browserbase.com/pricing | https://docs.browserbase.com | TBD | 2026-07-16 |  |
| **browseruse** | browser | TBD | TBD | TBD | 2026-07-16 | Agent will discover authoritative URLs |
| **hyperbrowser** | browser | https://www.hyperbrowser.ai/docs/pricing | https://www.hyperbrowser.ai/docs | TBD | 2026-07-16 |  |
| **kernel** | browser | https://www.kernel.sh/pricing | https://docs.kernel.sh | TBD | 2026-07-16 |  |
| **notte** | browser | TBD | TBD | TBD | 2026-07-16 | Agent will discover authoritative URLs |
| **steel** | browser | https://docs.steel.dev/overview/pricinglimits | https://docs.steel.dev | TBD | 2026-07-16 |  |
| **just-bash** | local | n/a | n/a | n/a | 2026-07-16 | Local utility provider; no external site |
| **secure-exec** | local | n/a | n/a | n/a | 2026-07-16 | Local utility provider; no external site |

## Agent usage

Invoke the `provider-maintenance-agent` custom droid for one provider at a time, e.g.:

```
Run the provider-maintenance-agent for e2b.
```

The agent reads this registry, fetches the listed URLs, compares the latest public information against the catalog entry in `docs/design/provider-billing-and-sku-matrix.md` and the provider package in `packages/<provider>/`, and opens a PR with any updates.

## Scheduling

For ongoing monitoring, schedule one invocation per provider (e.g., weekly or monthly) via a Factory automation. The droid is designed to run autonomously and create a PR only when it detects a real change.
