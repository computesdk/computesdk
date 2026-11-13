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
  anchors:
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

Remote mode uses the bridge Worker shipped in `packages/cloudflare/worker`. It requires a Workers Paid account and Docker to build the container images. See the [Worker source](../../../../packages/cloudflare/worker/) for deployment configuration.

You can print these setup instructions at any time by running:

```bash
npx @computesdk/cloudflare
```

> **Note:** This command only prints instructions — it does not deploy anything and does not require Docker.

### Step 1: Deploy the bridge Worker

From a checkout, enter `packages/cloudflare/worker`, run `npm ci`, authenticate with `npx wrangler login`, set the secret below, then run `npx wrangler deploy`.

### Step 2: Set the Worker's API key secret

From the bridge Worker project, set a strong generated `SANDBOX_API_KEY` secret:

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

### Snapshots and preview URLs

The adapter checks the Worker's `GET /v1/info` feature list. The bridge supports native files, HTTP/WebSocket preview URLs, and filesystem snapshots; an older demo Worker remains usable for commands/files but does not gain these features automatically.

`snapshot.create(instanceId)` captures the writable rootfs while keeping the container running. Restore with `instances.create({ snapshotId })`. Snapshots preserve files, not memory or processes. Data expires 30 days after creation or last restore; `snapshot.delete` removes the bridge's handle, not the underlying retained data. The adapter does not yet declare `snapshot.capabilities`, so do not infer unified memory/fork flags from method availability.

`sandbox.getUrl({ port })` works with the bridge. The server must listen on `0.0.0.0`; preview URLs forward HTTP and WebSockets and are accessible to anyone with the URL, without an API key.

## Usage

```typescript
import { cloudflare } from '@computesdk/cloudflare';

const compute = cloudflare({
  sandboxUrl: process.env.CLOUDFLARE_SANDBOX_URL,
  sandboxApiKey: process.env.CLOUDFLARE_SANDBOX_API_KEY,
});

// Create sandbox
const sandbox = await compute.instances.create();

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
const sandbox = await compute.instances.create({
  envs: { NODE_ENV: 'production' },
});
```

### Sandbox Size and Image

Choose the size and image of a new sandbox when you create it:

```typescript
const sandbox = await compute.instances.create({
  vcpu: 2,
  memoryMib: 6144,
  diskMb: 12000,
  image: 'builder',
});
```

| Option      | Description                                                                                                            |
| ----------- | ---------------------------------------------------------------------------------------------------------------------- |
| `vcpu`      | vCPUs of a [custom instance type](https://developers.cloudflare.com/containers/platform/limits/#custom-instance-types) |
| `memoryMib` | Memory of the custom instance type, in MiB                                                                             |
| `diskMb`    | Disk of the custom instance type, in MB                                                                                |
| `image`     | Name of an image declared by the sandbox demo Worker. `builder` has Node.js 24 and common build tools.                 |

Set `vcpu`, `memoryMib`, and `diskMb` together. Without them, the sandbox uses the Worker's default instance type. Without `image`, it uses the Worker's default image.

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
* Preview URLs require the bridge Worker's advertised port support; older demo Workers do not support them
* Listing all sandboxes is not supported — use `getById` to reconnect to a specific sandbox
