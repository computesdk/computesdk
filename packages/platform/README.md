# @computesdk/platform

ComputeSDK provider for [ComputeSDK Platform](https://platform.computesdk.com) hosted sandboxes — the same `compute` / `sandbox` interface as every other provider, backed by the platform's own sandbox API. Market placement, provider fallback, the secrets vault, warm pools and cost tracking all live server-side; your code gets one sandbox ID space and one API.

```bash
npm install computesdk @computesdk/platform
```

```typescript
import { compute } from 'computesdk';
import { platform } from '@computesdk/platform';

const sdk = compute({
  provider: platform({ apiKey: process.env.COMPUTE_API_KEY }),
});

const sandbox = await sdk.sandbox.create({ size: 'small' });
const result = await sandbox.runCommand('echo hello');
console.log(result.stdout);
await sandbox.destroy();
```

## Authentication

Credentials resolve once per provider instance, with the same precedence as the `compute` CLI:

1. `apiKey` in config
2. `COMPUTE_API_KEY` env var
3. `BENCHMARKS_PLATFORM_API_KEY` env var (legacy alias)
4. A `compute login` session (requires `@benchsdk/cli` installed — it's an optional peer dependency; the session store is read and refreshed but a login is never started)

Base URL resolves similarly: `baseUrl` in config, then `COMPUTE_PLATFORM_URL`, then `BENCHMARKS_PLATFORM_URL`, then `https://platform.computesdk.com`.

Credentials are only sent to `computesdk.com`, its subdomains, or loopback — pass `allowUntrustedHost: true` to send them elsewhere (HTTPS still required off-loopback). With no key configured you get a `no_credentials` error telling you to set `COMPUTE_API_KEY`, pass `apiKey`, or run `compute login`.

`org` in config (or `COMPUTE_ORG`) sends `X-Org-Slug` on every request, for API keys that span orgs. A stored login's saved org is never sent — the platform already knows the active org.

## Sizes and pricing

Creates accept either a platform `size` or raw resources — never both:

```typescript
// Sizes: 'small' | 'medium' | 'large' | 'xlarge'
await sdk.sandbox.create({ size: 'medium' });

// Or raw resources (aliases: cpus|vcpus, memoryMb|memoryMiB|memMiB|memory, diskMb|diskMiB)
await sdk.sandbox.create({ cpus: 4, memoryMb: 8192, diskMb: 20000 });
```

Market pricing options — `maxPrice: { usd, per: 'hour' }` and `orderType: 'market' | 'limit'` — can be passed per call or set once as `defaults` on the provider. `providerOrder` ranks where the platform tries to place the sandbox: your own provider keys by name, or `'market'` for the compute market.

```typescript
const provider = platform({
  apiKey: process.env.COMPUTE_API_KEY,
  defaults: {
    size: 'small',
    maxPrice: { usd: 0.5, per: 'hour' },
    providerOrder: ['e2b', 'market'], // own E2B key first, market on failure
  },
});
```

## Own-keys (no market)

A `providerOrder` with no `'market'` entry never touches the market — no buyer-lane approval, no credits, no cap; `maxPrice` and `orderType` are ignored (an own-key placement has no order semantics) and your provider bills you directly. The keys live in the org's vault, not in your code.

```typescript
const provider = platform({
  apiKey: process.env.COMPUTE_API_KEY,
  defaults: { providerOrder: ['e2b'] }, // own-keys only
});
```

Provider order resolution: the call's `providerOrder`, then `defaults.providerOrder`, then the org's sandbox provider order (dashboard), then its Actions provider order. An org with none of these defaults to `['market']` — so own-keys users must set a provider order somewhere.

## Errors

API failures throw `PlatformApiError` with three derived fields:

- `code` — the body's `details.code`, then top-level `code`, then a code derived from the HTTP status (`bad_request`, `unauthenticated`, `forbidden`, `not_found`, `conflict`, `payload_too_large`, `rate_limited`, `server_error`, `http_error`)
- `details` — the body's `details` object (e.g. `details.attempts` on a placement failure)
- `retryable` — true for 429/502/503/504, except market codes, which don't change on retry

The market codes: `market_cap_required`, `market_access_required`, `limit_not_met`, `above_protection_limit`, `insufficient_credits`, `no_market_capacity`, `no_provider_configured`, `market_lane_not_approved`. Plus `sandbox_booting`, `idempotency_key_reused`, and the client's own `PlatformClientError` codes (`no_credentials`, `untrusted_host`, `untrusted_host_stored_auth`, `insecure_transport`, `invalid_argument`, `stream_ended`, `create_outcome_unknown`). Both code unions are exported and intentionally open.

```typescript
try {
  await sdk.sandbox.create();
} catch (err) {
  if (err instanceof Error && 'code' in err) {
    switch ((err as { code: string }).code) {
      case 'insufficient_credits': /* top up */ break;
      case 'no_market_capacity': /* retry later */ break;
    }
  }
}
```

In multi-provider mode, `switch (err.code)` only sees the final error — the originals are on `err.errors`:

```typescript
import { e2b } from '@computesdk/e2b';

const sdk = compute({ providers: [platform({ apiKey: k }), e2b({ apiKey: ek })] });
try {
  await sdk.sandbox.create();
} catch (err) {
  const codes = ((err as { errors?: { code?: string }[] }).errors ?? []).map((e) => e.code);
  // e.g. ['no_market_capacity', 'unauthenticated']
}
```

One exception: an error marked `fallback: false` (only `create_outcome_unknown` today) rethrows immediately — a box may exist and be billing, so trying another provider could boot a second one.

Retries the SDK runs itself (the CLI does none of these): `sandbox_booting` exponential backoff up to ~60s (matched on the code — `no_market_capacity` is also a 503 and is never retried), `429` honoring `Retry-After`, and network errors on GET/DELETE only. No other POST is retried.

## Limits

- **Files**: ~4 MB per `readFile`/`writeFile` (UTF-8 bytes). The platform sits behind a 4.5 MB body cap; larger files need the upload/download URL route (not yet implemented).
- **Commands**: `timeout` caps at 290s — the platform clamps it silently, so the SDK rejects higher values with `invalid_argument`. Longer work goes to `runCommand(cmd, { background: true })` (the processes route).
- **Command length**: 64 KB.
- **Secrets**: up to 100 vault secret names per sandbox.

## Idempotent create

Every `create` mints an `sdk-create:<uuid>` idempotency key, so a network blip or the 310s request timeout replays the same request instead of placing a second sandbox. Pass your own `idempotencyKey` to make the create safe across process restarts:

```typescript
await sdk.sandbox.create({ size: 'small', idempotencyKey: 'deploy-2026-10-27-a' } as any);
```

Same key + same request → the existing sandbox back, whatever its status. Same key + different request → `idempotency_key_reused` (409). A failed placement frees the key.

If the outcome can't be determined within ~6 minutes, create throws `create_outcome_unknown` — check the org dashboard before retrying; the sandbox may still be creating.

## Other create options

`label` (≤200 chars, falls back to `name`), `secrets` (org vault names), `disk` (`{ diskId: '<orgSlug>/<diskId>', path, readonly?, branch? }`), `snapshotId`, `image`/`templateId`, `timeout` (→ `timeoutMs`), `envs` (merged under every command's `env`, request env wins).

## What maps where

| SDK call | Platform route |
|---|---|
| `sandbox.create` | `POST /api/v1/sandboxes` |
| `sandbox.getById` | `GET /api/v1/sandboxes/:id` (404 → `null`) |
| `sandbox.list` | `GET /api/v1/sandboxes?status=running` (follows `nextCursor`) |
| `sandbox.destroy` | `DELETE /api/v1/sandboxes/:id` (404 = gone) |
| `runCommand` | `POST /api/v1/sandboxes/:id/commands` (`cwd`, `env`, `timeoutMs`) |
| `runCommand` + callbacks | same, `Accept: text/event-stream` (`stdout`/`stderr`/`exit`/`error`) |
| `runCommand` + `background` | `POST /api/v1/sandboxes/:id/processes` |
| `getUrl` | `GET /api/v1/sandboxes/:id/urls?port=&protocol=` |
| `filesystem.*` | `GET/POST/DELETE /api/v1/sandboxes/:id/files` |

Templates are not supported by this provider.
