---
description: >-
  boxd provider for ComputeSDK - isolated Linux computers on their own microVMs
  that boot in milliseconds, with snapshots and HTTPS URLs for any port.
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

# boxd

[boxd](https://boxd.sh) provider for ComputeSDK - isolated Linux computers on their own microVMs that boot in milliseconds, with snapshots and HTTPS URLs for any port.

## Installation & Setup

```bash
npm install @computesdk/boxd
```

## Setup

1. Create an API key in the [boxd console](https://app.boxd.sh), or with the CLI: `boxd auth keys create computesdk --org <your-org>`
2. Set the environment variables:

```bash
export BOXD_API_KEY=bxd_your_api_key
export BOXD_ORG=your-org
```

`BOXD_ORG` is the org the key belongs to. Leave it out to use your personal computers.

## Quick Start

```typescript
import { compute } from 'computesdk';
import { boxd } from '@computesdk/boxd';

compute.setConfig({
  provider: boxd({ apiKey: process.env.BOXD_API_KEY, org: process.env.BOXD_ORG }),
});

const sandbox = await compute.instances.create();

const result = await sandbox.runCommand('node -v && python3 --version');
console.log(result.stdout);

await sandbox.destroy();
```

Or call the provider factory directly:

```typescript
import { boxd } from '@computesdk/boxd';

const sdk = boxd({ apiKey: process.env.BOXD_API_KEY, org: process.env.BOXD_ORG });
const sandbox = await sdk.sandbox.create({ vcpus: 4, timeout: 60 * 60 * 1000 });

// Save the computer as it is, then start new ones from it
const snapshot = await sdk.snapshot.create(sandbox.instanceId, { name: 'golden' });
const copy = await sdk.sandbox.create({ snapshotId: snapshot.id });
```

## Configuration

```typescript
interface BoxdConfig {
  /** boxd API key - if not provided, will use BOXD_API_KEY env var */
  apiKey?: string;
  /** boxd session token, used instead of an API key - defaults to BOXD_TOKEN */
  token?: string;
  /** Org to create and list computers in - defaults to BOXD_ORG */
  org?: string;
  /** Region to create in, e.g. `fra` or `nyc` - defaults to BOXD_REGION, then Frankfurt. Lists cover every region unless it is set. */
  region?: string;
  /** API endpoint - defaults to BOXD_BASE_URL, then boxd production */
  baseURL?: string;
  /** Per-request timeout for boxd API calls in milliseconds */
  timeout?: number;
  /** Seconds idle before a computer is suspended. 0 (the default) never suspends. */
  autoSuspendTimeout?: number;
}
```

## Create Options

| Option | Maps to | Notes |
|---|---|---|
| `vcpus` (or `cpu`, `cpus`) | `config.vcpu` | 1, 2 (default), 4 or 8. |
| `memoryMiB` (or `memory`, `memoryMb`, `memMiB`) | `config.memory` | 4096, 8192, 16384 or 32768. Every vCPU comes with 4 GiB, so either field names the whole size. |
| `snapshotId` (or `templateId`) | `fromSnapshot` | Starts as the snapshot was captured, with its size. |
| `timeout` | `deleteAfter` | Milliseconds until the computer is deleted, whatever it is doing. |
| `region` | `region` | `fra` (default) or another region your org has, such as `nyc`. `getById` and `destroy` find a computer in any region. |
| `envs` | | Exported in every command. |
| `name` | `name` | Unique in the org. Default `computesdk-<8 hex>`. |

`sizeClass` is reported as unsupported: the standard classes give each vCPU 1 or 2 GiB, and boxd gives it 4. `image` is refused: computers boot from the boxd base image (Ubuntu 24.04 with Docker, Node, Python, Go and git), so set one up, snapshot it, and create from the snapshot.

## Features

- **Isolated computers**: every computer is created with `isolated: true`, which removes the in-machine boxd CLI, integrations and account access from it
- **Command execution** with `cwd`, `env`, background commands, and exit code 124 when a `timeout` runs out
- **Live output**: `onStdout`/`onStderr` stream over boxd's exec API, with no port to expose
- **Filesystem** read, write, list, mkdir, exists and remove through boxd's file API
- **Port URLs**: `getUrl({ port })` returns a public `https://p<port>.<name>.boxd.sh` URL
- **Snapshots**: `snapshot.create`, `list` and `delete`, and `create({ snapshotId })`
- **Persistence**: a computer keeps its disk until you destroy it, and a stopped one is started again by the next command or file call

## Limitations

- Computers don't expire on their own. Call `destroy()`, or pass `timeout` at create.
- A new port URL needs about 15 seconds for its TLS certificate before it answers.
- Commands and files run as the user `boxd`. Use `sudo` in a command for anything outside its reach.
- Custom images and volumes are not supported.
- Needs Node.js 20 or newer.

## Links

- [boxd docs](https://docs.boxd.sh)
- [TypeScript SDK reference](https://docs.boxd.sh/reference/typescript-sdk)
