---
description: >-
  Tangle Sandbox provider for ComputeSDK - isolated Linux sandboxes with command
  execution, filesystem access and port URLs.
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
---

# Tangle Sandbox

[Tangle Sandbox](https://sandbox.tangle.tools) provider for ComputeSDK - isolated Linux sandboxes with command execution, filesystem access and port URLs, built on the `@tangle-network/sandbox` SDK.

## Installation & Setup

Requires Node.js 20.19 or newer.

```bash
npm install @computesdk/tangle
```

Add your Tangle credentials to a `.env` file:

```bash
TANGLE_API_KEY=your_tangle_api_key
# Optional; defaults to https://sandbox.tangle.tools
TANGLE_SANDBOX_BASE_URL=https://sandbox.tangle.tools
```

## Usage

```typescript
import { tangle } from '@computesdk/tangle';

const compute = tangle({
  apiKey: process.env.TANGLE_API_KEY,
});

// Create sandbox
const sandbox = await compute.instances.create({ image: 'node:22' });

// Run a command
const result = await sandbox.runCommand('node --version');
console.log(result.stdout);

// Files
await sandbox.filesystem.writeFile('/tmp/hello.txt', 'Hello from Tangle');
console.log(await sandbox.filesystem.readFile('/tmp/hello.txt'));

// Public URL for a port
console.log(await sandbox.getUrl({ port: 3000 }));

// Clean up
await sandbox.destroy();
```

### Configuration Options

```typescript
interface TangleConfig {
  /** API key - if not provided, will use TANGLE_API_KEY env var */
  apiKey?: string;
  /** API endpoint - if not provided, will use TANGLE_SANDBOX_BASE_URL, then https://sandbox.tangle.tools */
  baseUrl?: string;
  /** Default environment ID or OCI image reference, e.g. "node:22" */
  image?: string;
  /** Default CPU cores */
  cpu?: number;
  /** Default memory in MB */
  memory?: number;
  /** Default disk in GB */
  disk?: number;
  /** Default maximum sandbox lifetime in milliseconds */
  timeout?: number;
}
```

Per-create `image`, `templateId` (a saved Tangle template), `cpu`, `memory`, `disk`, `timeout`, `name`, `envs`, `metadata`, `ephemeral` and `idempotencyKey` override the defaults. `ephemeral: true` gives the sandbox a scratch home directory whose contents are lost when it restarts.

## Supported Operations

| Operation | Support |
|---|---|
| `instances.create` / `getById` / `list` / `destroy` | Yes; `list` omits deleted sandboxes |
| `runCommand` with `cwd`, `env`, `timeout`, `background` | Yes; a foreground `timeout` defaults to 600000 ms (10 minutes), the runtime's maximum, and must be a whole number of ms from 100 to 600000; a background command has no limit unless `timeout` is set |
| `filesystem` (read, write, mkdir, readdir, exists, remove) | Yes |
| `getUrl` | Yes, through the SDK's port exposure |
| Snapshot restore (`snapshotId`) | Not supported; throws |
| `runtime` names | Not supported; throws. Use an image such as `python:3.12-slim` |

`instance.getInstance()` returns the native `SandboxInstance` for SDK features beyond this mapping.
