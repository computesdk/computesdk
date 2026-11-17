---
description: Run code across sandbox providers through the ComputeSDK router with the TypeScript SDK.
---

# Sandboxes

Run code across providers through the ComputeSDK router. Install `computesdk` and call `compute.instances.create()`; routing, authentication and the sandbox lifecycle are built in. For terminal workflows, see the [CLI quickstart](../getting-started/quick-start.md).

Start with the [TypeScript SDK quickstart](../getting-started/sdk-quick-start.md) for a runnable example with cleanup, or use the [SDK overview](../sdk/README.md) to choose a guide.

```bash
npm install computesdk
```

```typescript
import { compute } from 'computesdk';

const sandbox = await compute.instances.create({ size: 'small' });
try {
  const result = await sandbox.runCommand('echo hello');
  console.log(result.stdout);
} finally {
  await sandbox.destroy();
}
```

## Authentication

Credentials resolve once per provider instance, with the same precedence as the `compute` CLI:

1. `apiKey` in the provider config
2. `COMPUTE_API_KEY` env var
3. `BENCHMARKS_PLATFORM_API_KEY` env var (legacy alias)
4. A saved `compute login` session (read and refreshed automatically; the SDK never starts a browser login)

`baseUrl` in config, then `COMPUTE_PLATFORM_URL`, then `BENCHMARKS_PLATFORM_URL`, then `https://platform.computesdk.com` selects the deployment. Credentials are only sent to `computesdk.com`, its subdomains, or loopback — pass `allowUntrustedHost: true` to send them elsewhere (HTTPS still required off-loopback).

`org` in config (or `COMPUTE_ORG`) sends `X-Org-Slug` on every request, for user logins; organization API keys remain scoped to their own org.

## Create options

The bundled router accepts either a platform `size` (`small` 1 vCPU/2 GiB, `medium` 2/4 GiB, `large` 4/8 GiB, `xlarge` 8/16 GiB, `2xlarge` 16/32 GiB, `3xlarge` 32/128 GiB) or raw resources (`cpus`/`vcpus`, `memoryMb`/`memoryMiB`/`memMiB`/`memory`, `diskMb`/`diskMiB`) — never both. A provider must have a verified preset for the requested shape; accepting a size name does not imply every provider or account supports it. These platform `size` names are separate from the direct adapters' opt-in [`sizeClass`](../reference/sizes.md) vocabulary.

```typescript
await compute.instances.create({ size: 'medium' });
await compute.instances.create({ cpus: 4, memoryMb: 8192, diskMb: 20000 });
```

Other options: `label`, `secrets` (org vault names injected into every command), `disk`, `snapshotId`, `image`/`templateId`, `timeout` (lifetime in ms), `envs`, and `idempotencyKey`.

## Saved routing and REST requests

A create without a provider pin or `providerOrder` (from the call or provider defaults) walks the org's saved Sandboxes router. Configure its managed strategy and BYOK mode through the [routing API](api-reference.md#routing). Managed accounts use platform billing; BYOK uses the org's own provider keys.

For REST `POST /api/v1/sandboxes`, `only` narrows the saved router to a nonempty array of registered provider names without regions, retaining its order. `byok` overrides its mode for this request: `off`, `first`, `fallback`, or `only`. These fields may be combined, but neither may accompany `provider` or `providerOrder`. For example, request a small sandbox using only managed Daytona capacity:

```json
{ "only": ["daytona"], "byok": "off", "size": "small" }
```

This leaves org settings unchanged. `GET /api/v1/sandboxes/quote` accepts the same mode override and comma-separated `only` names, such as `?only=daytona,e2b&byok=off&size=small`, to evaluate a concrete request.

`GET /api/v1/sandboxes/options` returns `{ byokMode, strategy, size, options }`. Managed rows have `account: "managed"`, `provider`, and `sizes` with per-size rates (null when not sold); BYOK rows have `account: "byok"`, `provider`, `region`, and `ready`. The size is the default used to order managed accounts; `cheapest` can rank differently at another size. Discovery does not reserve capacity or guarantee credentials, credits, or placement will succeed.

REST create responses include `sandbox` and may include `next` guidance: a lifetime/billing `note` and suggested `mcp`, `api`, and `cli` actions. MCP entries contain `{ tool, args, does }`, API entries `{ method, path, does }`, and CLI entries `{ command, does }`. Use `sandbox.id` to work with the sandbox and destroy it when finished; it runs and bills until timeout or destruction.

## Market pricing

`providerOrder` ranks where the platform tries to place the sandbox — your own provider keys by name, or `'market'` for the compute market. `orderType: 'market' | 'limit'` and `maxPrice: { usd, per: 'hour' }` control the fill. All three can be passed per call or set once as `defaults` on the provider:

```typescript
import { platform } from 'computesdk';

const provider = platform({
  apiKey: process.env.COMPUTE_API_KEY,
  defaults: {
    size: 'small',
    providerOrder: ['e2b', 'market'], // own E2B key first, market on failure
    maxPrice: { usd: 0.5, per: 'hour' },
  },
});
```

A `providerOrder` with no `'market'` entry never touches the market — no buyer-lane approval, no credits, no cap. Without an explicit order, creation follows the saved router described above.

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
