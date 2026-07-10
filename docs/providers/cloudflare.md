---
description: >-
  Install, configure, and use the Cloudflare provider for ComputeSDK to run
  sandboxes on Cloudflare's edge network.
layout:
  width: default
  title:
    visible: true
  description:
    visible: false
  tableOfContents:
    visible: true
  outline:
    visible: true
  pagination:
    visible: true
  metadata:
    visible: true
  tags:
    visible: true
  actions:
    visible: true
tags:
  - tag: benchmarked
    primary: true
---

# Cloudflare

{% embed url="https://www.computesdk.com/benchmarks/sandboxes/cloudflare/" %}

Cloudflare provider for ComputeSDK - Execute code in secure, isolated sandboxes on Cloudflare's edge network.

## Installation

```bash
npm install @computesdk/cloudflare
```

## Setup

To use the Cloudflare provider in remote mode, you connect to Cloudflare's official Sandbox bridge Worker. This only needs to be deployed once.

You can print these setup instructions at any time by running:

```bash
npx @computesdk/cloudflare
```

> **Note:** This command only prints instructions — it does not deploy anything and does not require Docker.

### Step 1: Deploy the official bridge Worker

Deploy Cloudflare's official Sandbox bridge Worker by following the guide at [developers.cloudflare.com/sandbox/bridge](https://developers.cloudflare.com/sandbox/bridge/).

### Step 2: Set the bridge Worker's API key secret

From your bridge Worker project, set the `SANDBOX_API_KEY` secret:

```bash
npx wrangler secret put SANDBOX_API_KEY
```

### Step 3: Configure your app

Add the bridge URL and the same API key to your `.env` file:

```bash
CLOUDFLARE_SANDBOX_URL=https://<your-bridge-subdomain>.workers.dev
CLOUDFLARE_SANDBOX_API_KEY=<same value as SANDBOX_API_KEY>
```

These are the only env vars needed at runtime.

> **Warm pool:** Warm pool support is configured on the bridge Worker. Set `WARM_POOL_TARGET` to a positive value (for example `WARM_POOL_TARGET=10`) to keep sandboxes warm.

## Usage

```typescript
import { cloudflare } from '@computesdk/cloudflare';

const compute = cloudflare({
  sandboxUrl: process.env.CLOUDFLARE_SANDBOX_URL,
  sandboxApiKey: process.env.CLOUDFLARE_SANDBOX_API_KEY,
});

// Create sandbox
const sandbox = await compute.sandbox.create();

// Run a command
const result = await sandbox.runCommand('echo "Hello from Cloudflare!"');
console.log(result.stdout); // "Hello from Cloudflare!"

// Clean up
await sandbox.destroy();
```

### Run Commands

```typescript
const result = await sandbox.runCommand('ls -la /app');
console.log(result.stdout);
```

### Filesystem

```typescript
await sandbox.filesystem.writeFile('/app/config.json', JSON.stringify({ key: 'value' }));
const content = await sandbox.filesystem.readFile('/app/config.json');

await sandbox.filesystem.mkdir('/app/data');
const files = await sandbox.filesystem.readdir('/app');
const exists = await sandbox.filesystem.exists('/app/config.json');
await sandbox.filesystem.remove('/app/temp.txt');
```

### Port Forwarding

```typescript
const url = await sandbox.getUrl({ port: 3000 });
console.log(`Service available at: ${url}`);
```

### Environment Variables

Pass environment variables at the provider level:

```typescript
const compute = cloudflare({
  sandboxUrl: process.env.CLOUDFLARE_SANDBOX_URL,
  sandboxApiKey: process.env.CLOUDFLARE_SANDBOX_API_KEY,
  envVars: {
    API_KEY: 'your-api-key',
    DATABASE_URL: 'postgresql://localhost:5432/mydb',
  },
});
```

Or per-sandbox at creation time:

```typescript
const sandbox = await compute.sandbox.create({
  envs: { NODE_ENV: 'production' },
});
```

### Configuration Options

```typescript
interface CloudflareConfig {
  /** URL of the deployed bridge Worker (remote mode) */
  sandboxUrl?: string;
  /** API key for authenticating with the bridge Worker */
  sandboxApiKey?: string;
  /** @deprecated Use sandboxApiKey instead. */
  sandboxSecret?: string;
  /** Durable Object binding (direct mode only - see below) */
  sandboxBinding?: any;
  /** Warm pool configuration (direct mode only) */
  warmPool?: {
    binding: any;
    target?: number;
    refreshInterval?: number;
    poolName?: string;
  };
  /** Execution timeout in milliseconds */
  timeout?: number;
  /** Default runtime environment */
  runtime?: string;
  /** Environment variables to pass to sandbox */
  envVars?: Record<string, string>;
  /** Options forwarded to the underlying @cloudflare/sandbox SDK (direct mode) */
  sandboxOptions?: {
    sleepAfter?: string | number;
    keepAlive?: boolean;
  };
}
```

## Limitations

* Resource limits apply based on your Cloudflare plan
* Some system calls may be restricted in the container environment
* Listing all sandboxes is not supported — use `getById` to reconnect to a specific sandbox
