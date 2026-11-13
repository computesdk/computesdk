---
description: >-
  Set up the Vercel provider for ComputeSDK, configure project credentials or
  OIDC auth, and create sandboxes to run commands.
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

# Vercel

{% embed url="https://www.computesdk.com/benchmarks/sandboxes/vercel/" %}

Vercel provider for ComputeSDK - Execute code in globally distributed serverless environments.

## Lifecycle

Create with `{ persistent: true }` to use `pause()`/`resume()`. Pause stops the session; resume restores the filesystem into a fresh session, **not** its memory or processes (`provider.instances.pause.memory: false`).

Snapshots capture the rootfs without memory. `snapshot.capabilities` has `destroysSource: true` and `source: 'stopped'`: the source still exists and needs explicit destruction. `destroy()` deletes the sandbox and its automatic snapshots rather than merely stopping it.

## Installation & Setup

```bash
npm install @computesdk/vercel
```

Add your Vercel credentials to a `.env` file:

```bash
VERCEL_TOKEN=your_vercel_token
VERCEL_TEAM_ID=your_vercel_team_id
VERCEL_PROJECT_ID=your_vercel_project_id
```

## Usage

```typescript
import { vercel } from '@computesdk/vercel';

const compute = vercel({
  token: process.env.VERCEL_TOKEN,
  teamId: process.env.VERCEL_TEAM_ID,
  projectId: process.env.VERCEL_PROJECT_ID,
});

// Create sandbox
const sandbox = await compute.instances.create();

// Run a command
const result = await sandbox.runCommand('echo "Hello from Vercel!"');
console.log(result.stdout); // "Hello from Vercel!"

// Clean up
await sandbox.destroy();
```

### Configuration Options

```typescript
interface VercelConfig {
  /** Vercel token - if not provided, will use env vars */
  token?: string;
  /** Team ID for team accounts */
  teamId?: string;
  /** Project ID */
  projectId?: string;
  /** Execution timeout in milliseconds */
  timeout?: number;
  /** Ports to expose on the sandbox */
  ports?: number[];
  /** Optional-daemond SSE port (defaults to 38989); false disables port exposure, not runtime selection */
  daemonSsePort?: number | false;
}
```

Streaming/processes use native hooks where implemented, otherwise the shell tier.
Opt into the daemon fallback with provider config `processRuntime: 'daemond'`;
`daemonSsePort` alone does not enable it.

### Authentication

When no credentials are provided in config (no `token`, `teamId`, or `projectId`), the provider falls back to OIDC authentication using the `VERCEL_OIDC_TOKEN` environment variable. Run `vercel env pull` to populate `VERCEL_OIDC_TOKEN` in your `.env` file. This is an alternative to the token-based authentication shown above.
