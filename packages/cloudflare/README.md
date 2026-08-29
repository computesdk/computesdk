# @computesdk/cloudflare

Cloudflare provider for ComputeSDK — execute code in secure, isolated sandboxes on Cloudflare's edge network using the official Cloudflare Sandbox bridge API.

## Installation

```bash
npm install @computesdk/cloudflare
```

## Setup

Deploy the official Cloudflare Sandbox bridge Worker by following the Cloudflare documentation:

https://developers.cloudflare.com/sandbox/bridge/

Configure the bridge Worker with an API key secret:

```bash
npx wrangler secret put SANDBOX_API_KEY
```

Then configure your application with the deployed bridge URL and the same API key:

```bash
CLOUDFLARE_SANDBOX_URL=https://<your-bridge-subdomain>.workers.dev
CLOUDFLARE_SANDBOX_API_KEY=<same value as SANDBOX_API_KEY>
```

Warm pool support is configured on the bridge Worker. Set `WARM_POOL_TARGET` to a positive value on the Worker to keep sandboxes warm, for example `WARM_POOL_TARGET=10`. Leave it at `0` to disable prewarming.

You can also run:

```bash
npx @computesdk/cloudflare
```

to print these setup instructions.

## Quick Start

```typescript
import { cloudflare } from '@computesdk/cloudflare';

const compute = cloudflare({
  sandboxUrl: process.env.CLOUDFLARE_SANDBOX_URL,
  sandboxApiKey: process.env.CLOUDFLARE_SANDBOX_API_KEY,
});

const sandbox = await compute.sandbox.create();

// Execute Python code
const result = await sandbox.runCommand(`python - <<'PY'
import sys
print(f"Python version: {sys.version}")
print("Hello from Cloudflare!")
PY`);

console.log(result.stdout);
await sandbox.destroy();
```

## Usage

### Run Commands

Use normal shell commands inside the sandbox:

```typescript
await sandbox.runCommand('python -c "print(\"Hello Python\")"');
await sandbox.runCommand('node -e "console.log(\"Hello Node.js\")"');
```

### List Files

```typescript
const result = await sandbox.runCommand('ls -la /workspace/app');
console.log(result.stdout);
```

### File System

```typescript
// Write and read files
await sandbox.filesystem.writeFile('/workspace/app/config.json', JSON.stringify({ key: 'value' }));
const content = await sandbox.filesystem.readFile('/workspace/app/config.json');

// Create directories
await sandbox.filesystem.mkdir('/workspace/app/data');

// List directory contents
const files = await sandbox.filesystem.readdir('/workspace/app');

// Check existence
const exists = await sandbox.filesystem.exists('/workspace/app/config.json');

// Remove files
await sandbox.filesystem.remove('/workspace/app/temp.txt');
```

### Port Forwarding

```typescript
// Start a web server in the sandbox
await sandbox.runCommand(`python - <<'PY'
import http.server, socketserver
PORT = 3000
with socketserver.TCPServer(("", PORT), http.server.SimpleHTTPRequestHandler) as httpd:
    httpd.serve_forever()
PY`);

// Get the public URL
const url = await sandbox.getUrl({ port: 3000 });
console.log(`Service available at: ${url}`);
```

### Environment Variables

Pass environment variables to sandbox commands at initialization:

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

## Configuration

```typescript
interface CloudflareConfig {
  /** URL of the deployed Cloudflare Sandbox bridge Worker */
  sandboxUrl?: string;
  /** API key that matches the bridge Worker's SANDBOX_API_KEY secret */
  sandboxApiKey?: string;
  /** Deprecated compatibility alias for sandboxApiKey */
  sandboxSecret?: string;
  /** Durable Object binding (direct mode only — see below) */
  sandboxBinding?: any;
  /** Optional WarmPool configuration for direct mode */
  warmPool?: {
    /** Durable Object binding for WarmPool from @cloudflare/sandbox/bridge */
    binding: any;
    /** Number of warm containers to keep ready */
    target?: number;
    /** Pool refresh interval in milliseconds */
    refreshInterval?: number;
    /** Durable Object pool name. Defaults to global-pool. */
    poolName?: string;
  };
  /** Execution timeout in milliseconds */
  timeout?: number;
  /** Environment variables to pass to sandbox commands */
  envVars?: Record<string, string>;
}
```

## Direct Mode

If your code already runs inside a Cloudflare Worker, you can skip the bridge Worker and use the Durable Object binding directly:

```typescript
import { cloudflare } from '@computesdk/cloudflare';

const compute = cloudflare({
  sandboxBinding: env.Sandbox,
});
```

This requires configuring the Sandbox Durable Object binding in your `wrangler.toml`. See the [Cloudflare Sandbox docs](https://developers.cloudflare.com/sandbox/get-started/) for setup instructions.

### Direct Mode Warm Pool

Warm pool support in direct mode is opt-in. Export the `WarmPool` Durable Object from `@cloudflare/sandbox/bridge`, bind it in Wrangler, then pass it via `warmPool.binding`:

```typescript
import { cloudflare } from '@computesdk/cloudflare';
import { Sandbox } from '@cloudflare/sandbox';
import { WarmPool } from '@cloudflare/sandbox/bridge';

export { Sandbox, WarmPool };

const compute = cloudflare({
  sandboxBinding: env.Sandbox,
  warmPool: {
    binding: env.WarmPool,
    target: 10,
    refreshInterval: 10_000,
  },
});
```

When `warmPool` is configured, ComputeSDK asks the official bridge `WarmPool` for an assigned container ID and then opens the sandbox through `sandboxBinding`. `getById` uses a non-allocating pool lookup and returns `null` when the logical sandbox ID has no existing assignment.

## Error Handling

```typescript
try {
  const result = await sandbox.runCommand('invalid python syntax');
} catch (error) {
  if (error.message.includes('Syntax error')) {
    console.log('Code has syntax errors');
  } else {
    console.log('Execution failed:', error.message);
  }
}
```

## Limitations

- Resource limits apply based on your Cloudflare plan
- Some system calls may be restricted in the container environment
- In remote bridge mode, filesystem paths must resolve within `/workspace`
- Listing all sandboxes is not supported — use `getById` to reconnect to a specific sandbox ID. Remote bridge `getById` returns a handle without allocating or verifying the sandbox until the first operation.

## License

MIT
