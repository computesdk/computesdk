# ComputeSDK Cloudflare Remote Example

This example shows how to use `@computesdk/cloudflare` from a Node.js process through the sandbox demo Worker's HTTP API.

Deploy and configure the sandbox demo Worker from the Cloudflare Containers demos repository:

- https://github.com/cloudflare/containers-demos/tree/main/sandbox

## Configure the Worker endpoint

Copy `.env.example` to `.env` and fill in the Worker URL and API key from your deployment:

```bash
cp examples/cloudflare-bridge/.env.example examples/cloudflare-bridge/.env
```

```bash
CLOUDFLARE_SANDBOX_URL=https://sandbox.<your-subdomain>.workers.dev
CLOUDFLARE_SANDBOX_API_KEY=<same value as SANDBOX_API_KEY>
```

## Run the ComputeSDK client

Install dependencies from the repository root, then run this example:

```bash
corepack pnpm install
corepack pnpm --filter @computesdk/example-cloudflare-bridge start
```

The client will:

1. create a sandbox through the Worker's HTTP API;
2. execute a command through the Worker's SSE exec endpoint;
3. write/read/list files under `/tmp` through ComputeSDK filesystem helpers;
4. destroy the sandbox.

The filesystem helpers execute shell commands through the Worker's exec endpoint.

For direct mode inside Cloudflare Workers, see `examples/cloudflare-direct`.
