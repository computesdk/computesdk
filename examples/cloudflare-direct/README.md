# ComputeSDK Cloudflare Direct Warm Pool Example

This example shows how to use `@computesdk/cloudflare` in direct mode from inside a Cloudflare Worker with a Sandbox `WarmPool` binding.

Use this example when your application already runs on Cloudflare Workers and can access the Sandbox Durable Object binding directly. If your application runs outside Workers, use `examples/cloudflare-bridge` with the official bridge endpoint instead.

## What this example includes

- `src/index.ts` — a Worker that creates a ComputeSDK Cloudflare sandbox in direct mode.
- `wrangler.jsonc` — Sandbox and WarmPool Durable Object bindings plus a cron trigger that prewarms the pool.
- `Dockerfile` — the sandbox container image used by the `Sandbox` container class.

## Run locally

Install dependencies from the repository root, then start Wrangler:

```bash
corepack pnpm install
corepack pnpm --filter @computesdk/example-cloudflare-direct dev
```

Open the local Worker URL. The Worker will:

1. create a sandbox in direct mode using the WarmPool binding;
2. execute a command;
3. write and read a file under `/workspace`;
4. destroy the sandbox.

The WarmPool Durable Object keeps containers warm on its own alarm loop once it
has been configured, and ComputeSDK keeps that configuration in sync on each
sandbox operation. To warm the pool even before the first request arrives, the
Worker reuses the official bridge `scheduled` handler (`bridge({}).scheduled`) on
a cron trigger to prime the pool. It exposes no bridge HTTP routes — only the
`scheduled` priming behavior is reused.

## Deploy

```bash
corepack pnpm --filter @computesdk/example-cloudflare-direct deploy
```

By default, `wrangler.jsonc` keeps five warm containers available:

```jsonc
"WARM_POOL_TARGET": "5",
"WARM_POOL_REFRESH_INTERVAL": "10000"
```

Adjust those values before deployment to match your workload and account limits.
