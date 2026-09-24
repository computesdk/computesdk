# @computesdk/cloudflare

Cloudflare provider for ComputeSDK — execute code in secure, isolated containers on Cloudflare's edge network.

## Installation

```bash
npm install @computesdk/cloudflare
```

## Setup

Deploy the Cloudflare sandbox demo Worker from the Cloudflare Containers demos repository:

https://github.com/cloudflare/containers-demos/tree/main/sandbox

Configure the sandbox demo Worker with an API key secret:

```bash
npx wrangler secret put SANDBOX_API_KEY
```

Then configure your application with the deployed Worker URL and the same API key:

```bash
CLOUDFLARE_SANDBOX_URL=https://sandbox.<your-subdomain>.workers.dev
CLOUDFLARE_SANDBOX_API_KEY=<same value as SANDBOX_API_KEY>
```

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

const result = await sandbox.runCommand(
  "node -e 'console.log(\"Hello from Cloudflare!\")'"
);

console.log(result.stdout);
await sandbox.destroy();
```

## Usage

### Run Commands

Use normal shell commands inside the sandbox:

```typescript
await sandbox.runCommand('echo "Hello from Cloudflare"');
await sandbox.runCommand("node -e 'console.log(\"Hello Node.js\")'");
```

### List Files

```typescript
const result = await sandbox.runCommand('ls -la /tmp/app');
console.log(result.stdout);
```

### File System

```typescript
// Create directories
await sandbox.filesystem.mkdir('/tmp/app/data');

// Write and read files
await sandbox.filesystem.writeFile('/tmp/app/config.json', JSON.stringify({ key: 'value' }));
const content = await sandbox.filesystem.readFile('/tmp/app/config.json');

// List directory contents
const files = await sandbox.filesystem.readdir('/tmp/app');

// Check existence
const exists = await sandbox.filesystem.exists('/tmp/app/config.json');

// Remove files
await sandbox.filesystem.remove('/tmp/app/temp.txt');
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
  /** URL of the deployed sandbox demo Worker */
  sandboxUrl?: string;
  /** API key that matches the Worker's SANDBOX_API_KEY secret */
  sandboxApiKey?: string;
  /** Deprecated compatibility alias for sandboxApiKey */
  sandboxSecret?: string;
  /** Durable Object binding to the sandbox demo Worker's Sandbox class (direct mode only) */
  sandboxBinding?: any;
  /** Execution timeout in milliseconds (default 30,000; maximum 900,000) */
  timeout?: number;
  /** Environment variables to pass to sandbox commands */
  envVars?: Record<string, string>;
}
```

## Direct Mode

If your code already runs inside a Cloudflare Worker, bind directly to the `Sandbox` Durable Object exported by the sandbox demo Worker:

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

Then pass that binding to the provider:

```typescript
import { cloudflare } from '@computesdk/cloudflare';

const compute = cloudflare({
  sandboxBinding: env.SANDBOX,
});
```

## Error Handling

```typescript
const result = await sandbox.runCommand('command-that-does-not-exist');
if (result.exitCode !== 0) {
  console.error(result.stderr);
}
```

## Limitations

- Resource limits apply based on your Cloudflare plan
- Some system calls may be restricted in the container environment
- Port forwarding is not supported
- Listing all sandboxes is not supported — use `getById` to reconnect to a specific sandbox ID.

## License

MIT
