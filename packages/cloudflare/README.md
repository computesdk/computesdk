# @computesdk/cloudflare

Cloudflare provider for ComputeSDK — execute code in secure, isolated sandboxes on Cloudflare's edge network.

## Installation

```bash
npm install @computesdk/cloudflare
```

## Setup

Run the setup command to deploy a gateway Worker to your Cloudflare account:

```bash
npx @computesdk/cloudflare
```

This requires two environment variables:

- `CLOUDFLARE_API_TOKEN` — a Cloudflare API token with the following permissions:
  - Workers Scripts: Read & Edit
  - Workers KV Storage: Read & Edit
  - Account Settings: Read
  - Workers Tail: Read
- `CLOUDFLARE_ACCOUNT_ID` — your Cloudflare account ID

You can set these in a `.env` file or export them in your shell. Get your API token at [dash.cloudflare.com/profile/api-tokens](https://dash.cloudflare.com/profile/api-tokens).

The setup command will deploy the gateway Worker and output two values:

```
CLOUDFLARE_SANDBOX_URL=https://computesdk-sandbox.<subdomain>.workers.dev
CLOUDFLARE_SANDBOX_SECRET=<generated-secret>
```

Add these to your `.env` file. These are the only env vars needed at runtime.

> **Note:** Docker must be installed for the setup command to build the sandbox container image.

## Quick Start

```typescript
import { cloudflare } from '@computesdk/cloudflare';

const compute = cloudflare({
  sandboxUrl: process.env.CLOUDFLARE_SANDBOX_URL,
  sandboxSecret: process.env.CLOUDFLARE_SANDBOX_SECRET,
});

const sandbox = await compute.sandbox.create();

// Execute Python code
const result = await sandbox.runCommand(`
import sys
print(f"Python version: {sys.version}")
print("Hello from Cloudflare!")
`);

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
const result = await sandbox.runCommand('ls -la /app');
console.log(result.stdout);
```

### File System

```typescript
// Write and read files
await sandbox.filesystem.writeFile('/app/config.json', JSON.stringify({ key: 'value' }));
const content = await sandbox.filesystem.readFile('/app/config.json');

// Create directories
await sandbox.filesystem.mkdir('/app/data');

// List directory contents
const files = await sandbox.filesystem.readdir('/app');

// Check existence
const exists = await sandbox.filesystem.exists('/app/config.json');

// Remove files
await sandbox.filesystem.remove('/app/temp.txt');
```

### Port Forwarding

```typescript
// Start a web server in the sandbox
await sandbox.runCommand(`
import http.server, socketserver
PORT = 3000
with socketserver.TCPServer(("", PORT), http.server.SimpleHTTPRequestHandler) as httpd:
    httpd.serve_forever()
`);

// Get the public URL
const url = await sandbox.getUrl({ port: 3000 });
console.log(`Service available at: ${url}`);
```

### Environment Variables

Pass environment variables to the sandbox at initialization:

```typescript
const compute = cloudflare({
  sandboxUrl: process.env.CLOUDFLARE_SANDBOX_URL,
  sandboxSecret: process.env.CLOUDFLARE_SANDBOX_SECRET,
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
  /** URL of the deployed gateway Worker */
  sandboxUrl?: string;
  /** Shared secret for authenticating with the gateway Worker */
  sandboxSecret?: string;
  /** Durable Object binding (direct mode only — see below) */
  sandboxBinding?: any;
  /** Default runtime: 'python' | 'node' | 'bun' | 'deno' */
  runtime?: Runtime;
  /** Execution timeout in milliseconds */
  timeout?: number;
  /** Environment variables to pass to sandbox */
  envVars?: Record<string, string>;
}
```

## Direct Mode

If your code already runs inside a Cloudflare Worker, you can skip the gateway and use the Durable Object binding directly:

```typescript
import { cloudflare } from '@computesdk/cloudflare';

const compute = cloudflare({
  sandboxBinding: env.Sandbox,
});
```

This requires configuring the Sandbox Durable Object binding in your `wrangler.toml`. See the [Cloudflare Sandbox docs](https://developers.cloudflare.com/sandbox/get-started/) for setup instructions.

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
- Listing all sandboxes is not supported — use `getById` to reconnect to a specific sandbox

## License

MIT
