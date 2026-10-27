---
description: >-
  Drive hosted ComputeSDK Platform sandboxes from code with
  @computesdk/platform — the same compute/sandbox interface as every other
  provider, with placement, pricing and billing handled server-side.
---

# Sandboxes

Hosted sandboxes run code on the platform's compute — your org's registered providers or a compute-market fill — with no per-provider SDK in your code. Use the `@computesdk/platform` provider; it gives hosted sandboxes the same `compute` interface as every other ComputeSDK provider, so the same code works across hosted and self-managed placements. To drive sandboxes from a shell instead, see the [`compute sandboxes` CLI reference](cli.md#compute-sandboxes).

```bash
npm install computesdk @computesdk/platform
```

```typescript
import { compute } from 'computesdk';
import { platform } from '@computesdk/platform';

compute.setConfig({
  provider: platform({ apiKey: process.env.COMPUTE_API_KEY }),
});

const sandbox = await compute.sandbox.create({ size: 'small' });
const result = await sandbox.runCommand('echo hello');
console.log(result.stdout);
await sandbox.destroy();
```

## Authentication

Credentials resolve once per provider instance, with the same precedence as the `compute` CLI:

1. `apiKey` in the provider config
2. `COMPUTE_API_KEY` env var
3. `BENCHMARKS_PLATFORM_API_KEY` env var (legacy alias)
4. A `compute login` session (requires `@benchsdk/cli` installed — an optional peer; the session is read and refreshed but a login is never started)

`baseUrl` in config, then `COMPUTE_PLATFORM_URL`, then `BENCHMARKS_PLATFORM_URL`, then `https://platform.computesdk.com` selects the deployment. Credentials are only sent to `computesdk.com`, its subdomains, or loopback — pass `allowUntrustedHost: true` to send them elsewhere (HTTPS still required off-loopback).

`org` in config (or `COMPUTE_ORG`) sends `X-Org-Slug` on every request, for logins or keys that span orgs.

## Create options

Creates accept either a platform `size` (`small` 1 vCPU/2 GB, `medium` 2/4 GB, `large` 4/8 GB, `xlarge` 8/16 GB) or raw resources (`cpus`/`vcpus`, `memoryMb`/`memoryMiB`/`memMiB`/`memory`, `diskMb`/`diskMiB`) — never both.

```typescript
await compute.sandbox.create({ size: 'medium' });
await compute.sandbox.create({ cpus: 4, memoryMb: 8192, diskMb: 20000 });
```

Other options: `label`, `secrets` (org vault names injected into every command), `disk`, `snapshotId`, `image`/`templateId`, `timeout` (lifetime in ms), `envs`, and `idempotencyKey`.

## Market pricing

`providerOrder` ranks where the platform tries to place the sandbox — your own provider keys by name, or `'market'` for the compute market. `orderType: 'market' | 'limit'` and `maxPrice: { usd, per: 'hour' }` control the fill. All three can be passed per call or set once as `defaults` on the provider:

```typescript
const provider = platform({
  apiKey: process.env.COMPUTE_API_KEY,
  defaults: {
    size: 'small',
    providerOrder: ['e2b', 'market'], // own E2B key first, market on failure
    maxPrice: { usd: 0.5, per: 'hour' },
  },
});
```

A `providerOrder` with no `'market'` entry never touches the market — no buyer-lane approval, no credits, no cap. An org with no provider order configured anywhere defaults to `['market']`.

## Commands and files

```typescript
// One-shot commands — buffered result
const result = await sandbox.runCommand('ls -la');

// cwd / env / timeout; up to ~290s per command
await sandbox.runCommand('npm test', {
  cwd: '/app',
  env: { NODE_ENV: 'production' },
  timeout: 120000,
});

// Streaming output
await sandbox.runCommand('npm test', {
  onStdout: (chunk) => process.stdout.write(chunk),
});

// Longer work runs detached
await sandbox.runCommand('npm run dev', { background: true });

// Files — ~4 MB per call
await sandbox.filesystem.writeFile('/app/index.js', 'console.log("hi")');
const content = await sandbox.filesystem.readFile('/app/index.js');
const entries = await sandbox.filesystem.readdir('/app');
```

## Errors

API failures throw `PlatformApiError` with three derived fields:

- `code` — `details.code`, then top-level `code`, then a code derived from the HTTP status
- `details` — the body's `details` object
- `retryable` — `true` for 429/502/503/504, except market codes, which don't change on retry

Market codes: `market_cap_required`, `market_access_required`, `limit_not_met`, `above_protection_limit`, `insufficient_credits`, `no_market_capacity`, `no_provider_configured`, `market_lane_not_approved`. The provider itself can raise `no_credentials`, `untrusted_host`, `insecure_transport`, `invalid_argument`, `stream_ended`, or `create_outcome_unknown`.

In multi-provider mode the thrown error keeps each provider's original error on `err.errors`. One exception: `create_outcome_unknown` rethrows immediately (`fallback: false`) — a box may exist and be billing, so trying another provider could boot a second one.

## Limits

- **Files**: ~4 MB per `readFile`/`writeFile` (UTF-8 bytes) — larger values fail client-side with `invalid_argument`
- **Commands**: `timeout` caps at 290s — longer work belongs on a detached process (`background: true`)
- **Command length**: 64 KB

## Idempotent create

Every `create` mints an `sdk-create:<uuid>` idempotency key, so a network blip replays the same request instead of placing a second sandbox. Pass your own `idempotencyKey` (≤200 chars) to make a create safe across process restarts: same key + same request returns the existing sandbox whatever its status; same key + different request fails `409 idempotency_key_reused`. If the outcome can't be determined within ~6 minutes the create throws `create_outcome_unknown` — check the dashboard before retrying.
