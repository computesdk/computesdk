# ComputeSDK Cloudflare Bridge Example

This example shows how to use `@computesdk/cloudflare` from a Node.js process against an official Cloudflare Sandbox bridge endpoint.

The bridge Worker implementation is not included in this repository. Deploy and configure the official bridge by following the Cloudflare documentation:

- https://developers.cloudflare.com/sandbox/bridge/

## Configure the bridge endpoint

Copy `.env.example` to `.env` and fill in the bridge URL and API key from your official bridge deployment:

```bash
cp examples/cloudflare-bridge/.env.example examples/cloudflare-bridge/.env
```

```bash
CLOUDFLARE_SANDBOX_URL=https://cloudflare-sandbox-bridge.<your-subdomain>.workers.dev
CLOUDFLARE_SANDBOX_API_KEY=<same value as SANDBOX_API_KEY>
```

## Run the ComputeSDK client

Install dependencies from the repository root, then run this example:

```bash
corepack pnpm install
corepack pnpm --filter @computesdk/example-cloudflare-bridge start
```

The client will:

1. create a sandbox through the bridge API;
2. execute a command through the bridge SSE exec endpoint;
3. write/read/list files under `/workspace` through ComputeSDK filesystem helpers;
4. destroy the sandbox.

For direct mode inside Cloudflare Workers with a warm pool, see `examples/cloudflare-direct`.
