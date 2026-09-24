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

To use the Cloudflare provider in remote mode, deploy the Cloudflare sandbox demo Worker once and connect to it over HTTP.

You can print these setup instructions at any time by running:

```bash
npx @computesdk/cloudflare
```

> **Note:** This command only prints instructions — it does not deploy anything and does not require Docker.

### Step 1: Deploy the sandbox demo Worker

Follow the deployment instructions for the [sandbox demo Worker](https://github.com/cloudflare/containers-demos/tree/main/sandbox).

### Step 2: Set the Worker's API key secret

From the sandbox demo Worker project, set the `SANDBOX_API_KEY` secret:

```bash
npx wrangler secret put SANDBOX_API_KEY
```

### Step 3: Configure your app

Add the Worker URL and the same API key to your `.env` file:

```bash
CLOUDFLARE_SANDBOX_URL=https://sandbox.<your-subdomain>.workers.dev
CLOUDFLARE_SANDBOX_API_KEY=<same value as SANDBOX_API_KEY>
```

These are the only env vars needed at runtime.

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
const result = await sandbox.runCommand('ls -la /tmp');
console.log(result.stdout);
```

### Filesystem

```typescript
await sandbox.filesystem.mkdir('/tmp/app/data');
await sandbox.filesystem.writeFile('/tmp/app/config.json', JSON.stringify({ key: 'value' }));
const content = await sandbox.filesystem.readFile('/tmp/app/config.json');

const files = await sandbox.filesystem.readdir('/tmp/app');
const exists = await sandbox.filesystem.exists('/tmp/app/config.json');
await sandbox.filesystem.remove('/tmp/app/temp.txt');
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
  /** URL of the deployed sandbox demo Worker (remote mode) */
  sandboxUrl?: string;
  /** API key for authenticating with the Worker */
  sandboxApiKey?: string;
  /** @deprecated Use sandboxApiKey instead. */
  sandboxSecret?: string;
  /** Durable Object binding to the sandbox demo Worker's Sandbox class (direct mode only) */
  sandboxBinding?: any;
  /** Execution timeout in milliseconds (default 30,000; maximum 900,000) */
  timeout?: number;
  /** Environment variables to pass to sandbox */
  envVars?: Record<string, string>;
}
```

## Direct Mode

A Cloudflare Worker can call the sandbox demo Worker's Durable Object directly instead of using its HTTP API. Add a cross-script Durable Object binding to the Worker that uses ComputeSDK:

```jsonc
{
  "durable_objects": {
    "bindings": [
      {
        "name": "SANDBOX",
        "class_name": "Sandbox",
        "script_name": "sandbox"
      }
    ]
  }
}
```

Pass the binding to the provider:

```typescript
const compute = cloudflare({
  sandboxBinding: env.SANDBOX,
});
```

## Limitations

* Resource limits apply based on your Cloudflare plan
* Some system calls may be restricted in the container environment
* Port forwarding is not supported
* Listing all sandboxes is not supported — use `getById` to reconnect to a specific sandbox
