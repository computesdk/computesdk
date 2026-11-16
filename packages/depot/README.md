# @computesdk/depot

[Depot Sandboxes](https://depot.dev/docs/sandboxes/overview) provider for ComputeSDK. Depot sandboxes are isolated Linux microVMs (x86-64 or ARM64) with a full Linux environment, including Docker. This package wraps the official [`@depot/sandbox`](https://www.npmjs.com/package/@depot/sandbox) SDK (beta).

## Features

- Create, get, list and destroy sandboxes
- Run shell commands with `cwd`, `env` and background (detached) mode
- Native filesystem access (read, write, mkdir, readdir, exists, remove)
- Snapshots: save a sandbox's files and boot a new sandbox from them
- `amd64` or `arm64`, with configurable vCPUs, memory and disk

## Installation

Requires Node.js 20.19 or newer.

```bash
npm install @computesdk/depot
```

## Configuration

```bash
DEPOT_TOKEN=your_depot_token
# Required for organization/service tokens, or user tokens in more than one org
DEPOT_ORG_ID=your_depot_org_id
```

```typescript
interface DepotConfig {
  /** Depot token - falls back to DEPOT_TOKEN */
  token?: string;
  /** Organization ID - falls back to DEPOT_ORG_ID */
  orgId?: string;
  /** API endpoint - defaults to https://api.depot.dev */
  endpoint?: string;
  /** Default CPU architecture: 'amd64' (default) or 'arm64' */
  architecture?: 'amd64' | 'arm64';
  /** Default image; must be a Depot snapshot image on registry.depot.dev */
  image?: string;
  /** Default vCPUs (2 to 64) */
  vcpus?: number;
  /** Default memory in MB */
  memoryMb?: number;
  /** Default disk in GB */
  diskGb?: number;
  /** Default lifetime in ms, rounded up to whole minutes (server default 2 h, max 24 h) */
  timeout?: number;
  /** How long create() waits for the sandbox to be running, in ms (default 300000) */
  readyTimeout?: number;
}
```

## Usage

```typescript
import { depot } from '@computesdk/depot';

const compute = depot({ token: process.env.DEPOT_TOKEN });

const sandbox = await compute.instances.create();

const result = await sandbox.runCommand('uname -a');
console.log(result.stdout);

await sandbox.filesystem.writeFile('/home/runner/hello.txt', 'Hello from Depot');
console.log(await sandbox.filesystem.readFile('/home/runner/hello.txt'));

// Save files and boot a new sandbox from them
const snapshot = await compute.snapshot!.create(sandbox.instanceId);
const copy = await compute.instances.create({ snapshotId: snapshot.id });

await copy.destroy();
await sandbox.destroy();
```

Per-create `image` (or `templateId`), `vcpus`/`cpu`, `memoryMb`/`memory`, `timeout`, `name`, `envs` and `snapshotId` override the defaults.

## Supported Operations

| Operation | Support |
|---|---|
| `instances.create` / `getById` / `list` / `destroy` | Yes; `create` waits until the sandbox is `running`; `list` returns sandboxes that have not ended; `destroy` kills the sandbox |
| `runCommand` with `cwd`, `env`, `background` | Yes; commands run through `/bin/sh -c` |
| `runCommand` `timeout` | Not supported by the Depot API; ignored |
| `filesystem` | Yes, through the SDK's native file system API |
| `getUrl` | Not supported; throws (the Depot SDK has no API for public port URLs) |
| `snapshot.create` and `create({ snapshotId })` | Yes; snapshots keep the home directory and `/workspace`, not `/tmp` or running processes |
| `snapshot.list` / `snapshot.delete` | Not supported by the SDK; throws |
| `runtime` names | Not supported; throws. Use `image` |

`instance.getInstance()` returns the native `Sandbox` from `@depot/sandbox` for features beyond this mapping (logs, tailnet, `setTimeout`, CI secrets).

## Limitations

- Custom images must be Depot snapshot images hosted on Depot Registry; standard container images (for example `ubuntu:24.04`) can't boot.
- The `@depot/sandbox` SDK is in beta.
