# Cloudflare

Cloudflare provider for ComputeSDK - Execute code in secure, isolated sandboxes on Cloudflare's edge network.

## Installation

```bash
npm install @computesdk/cloudflare
```

## Setup

Before using the Cloudflare provider, you need to deploy a gateway Worker to your Cloudflare account. This only needs to be done once.

### Step 1: Set Cloudflare credentials

Add your Cloudflare credentials to a `.env` file or export them in your shell:

```bash
CLOUDFLARE_API_TOKEN=your_cloudflare_api_token
CLOUDFLARE_ACCOUNT_ID=your_cloudflare_account_id
```

Your API token needs the following permissions:
- Workers Scripts: Read & Edit
- Workers KV Storage: Read & Edit
- Account Settings: Read
- Workers Tail: Read

Get your API token at [dash.cloudflare.com/profile/api-tokens](https://dash.cloudflare.com/profile/api-tokens).

### Step 2: Deploy the gateway Worker

Run the setup command to deploy the gateway Worker:

```bash
npx @computesdk/cloudflare
```

> **Note:** Docker must be installed for the setup command to build the sandbox container image.

The setup command will output two values:

```
CLOUDFLARE_SANDBOX_URL=https://computesdk-sandbox.<subdomain>.workers.dev
CLOUDFLARE_SANDBOX_SECRET=<generated-secret>
```

Add these to your `.env` file. These are the only env vars needed at runtime.

## Usage

```typescript
import { cloudflare } from '@computesdk/cloudflare';

const compute = cloudflare({
  sandboxUrl: process.env.CLOUDFLARE_SANDBOX_URL,
  sandboxSecret: process.env.CLOUDFLARE_SANDBOX_SECRET,
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

### Configuration Options

```typescript
interface CloudflareConfig {
  /** URL of the deployed gateway Worker */
  sandboxUrl?: string;
  /** Shared secret for authenticating with the gateway Worker */
  sandboxSecret?: string;
  /** Durable Object binding (direct mode only - see below) */
  sandboxBinding?: any;
  /** Execution timeout in milliseconds */
  timeout?: number;
  /** Environment variables to pass to sandbox */
  envVars?: Record<string, string>;
}
```

## Limitations

- Resource limits apply based on your Cloudflare plan
- Some system calls may be restricted in the container environment
- Listing all sandboxes is not supported — use `getById` to reconnect to a specific sandbox
