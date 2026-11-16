---
description: >-
  Depot Sandboxes provider for ComputeSDK - isolated Linux microVMs with command
  execution, filesystem access and snapshots.
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

# Depot

[Depot Sandboxes](https://depot.dev/docs/sandboxes/overview) provider for ComputeSDK - isolated Linux microVMs (x86-64 or ARM64) with command execution, filesystem access and snapshots, built on the `@depot/sandbox` SDK.

## Installation & Setup

Requires Node.js 20.19 or newer.

```bash
npm install @computesdk/depot
```

Add your Depot credentials to a `.env` file:

```bash
DEPOT_TOKEN=your_depot_token
# Required for organization/service tokens
DEPOT_ORG_ID=your_depot_org_id
```

## Usage

```typescript
import { depot } from '@computesdk/depot';

const compute = depot({
  token: process.env.DEPOT_TOKEN,
});

// Create sandbox
const sandbox = await compute.instances.create();

// Run a command
const result = await sandbox.runCommand('echo "Hello from Depot!"');
console.log(result.stdout);

// Files
await sandbox.filesystem.writeFile('/home/runner/hello.txt', 'Hello from Depot');
console.log(await sandbox.filesystem.readFile('/home/runner/hello.txt'));

// Clean up
await sandbox.destroy();
```

### Configuration Options

```typescript
interface DepotConfig {
  /** Depot token - if not provided, will use DEPOT_TOKEN env var */
  token?: string;
  /** Organization ID - if not provided, will use DEPOT_ORG_ID env var */
  orgId?: string;
  /** API endpoint - defaults to https://api.depot.dev */
  endpoint?: string;
  /** Default CPU architecture: 'amd64' (default) or 'arm64' */
  architecture?: 'amd64' | 'arm64';
  /** Default image; must be a Depot snapshot image on registry.depot.dev */
  image?: string;
  /** Default vCPUs, memory in MB and disk in GB */
  vcpus?: number;
  memoryMb?: number;
  diskGb?: number;
  /** Default lifetime in milliseconds, rounded up to whole minutes */
  timeout?: number;
  /** How long create() waits for the sandbox to be running, in ms */
  readyTimeout?: number;
}
```

## Supported Operations

| Operation | Support |
|---|---|
| `instances.create` / `getById` / `list` / `destroy` | Yes |
| `runCommand` with `cwd`, `env`, `background` | Yes; `timeout` is ignored (no API support) |
| `filesystem` | Yes |
| `getUrl` | Not supported; throws |
| `snapshot.create` and `create({ snapshotId })` | Yes; keeps the home directory and `/workspace` |
| `snapshot.list` / `snapshot.delete` | Not supported; throws |

Custom images must be Depot snapshot images on Depot Registry; standard container images can't boot.
