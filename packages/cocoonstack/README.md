# @computesdk/cocoonstack

Cocoon Stack provider for ComputeSDK - self-hosted microVM sandboxes served from warm pools by [sandboxd](https://github.com/cocoonstack/sandbox), the sandbox control plane of the Cocoon Stack.

## Installation

```bash
npm install @computesdk/cocoonstack
```

## Setup

1. Run a sandboxd node (see the [deployment guide](https://github.com/cocoonstack/sandbox/blob/main/docs/deploy.md)) with a pool for the template you want to claim, and put it behind TLS.
2. Set the endpoint and a node or tenant API token:

```bash
export COCOONSTACK_API_URL=https://sandbox.example.com
export COCOONSTACK_API_KEY=your_api_token
```

## Quick Start

```typescript
import { compute } from 'computesdk';
import { cocoonstack } from '@computesdk/cocoonstack';

compute.setConfig({
  provider: cocoonstack({
    baseUrl: process.env.COCOONSTACK_API_URL,
    apiKey: process.env.COCOONSTACK_API_KEY,
  }),
});

const sandbox = await compute.sandbox.create();

const result = await sandbox.runCommand('node -v');
console.log(result.stdout);

await sandbox.destroy();
```

Or call the provider factory directly:

```typescript
import { cocoonstack } from '@computesdk/cocoonstack';

const sdk = cocoonstack({ baseUrl: process.env.COCOONSTACK_API_URL, apiKey: process.env.COCOONSTACK_API_KEY });
const sandbox = await sdk.sandbox.create({ templateId: 'python-rt:3.12', vcpus: 4, memoryMb: 4096 });
```

## Configuration

```typescript
interface CocoonstackConfig {
  /** sandboxd endpoint - if not provided, will use COCOONSTACK_API_URL env var */
  baseUrl?: string;
  /** Node or tenant API token - if not provided, will use COCOONSTACK_API_KEY env var */
  apiKey?: string;
  /** Default template, a pool key such as node-rt:24.04 (the default) */
  template?: string;
  /** Default network lane: 'none' (default) or 'egress' */
  net?: 'none' | 'egress';
  /** Default size tier: small (default), medium, large, xlarge, 2xlarge */
  size?: 'small' | 'medium' | 'large' | 'xlarge' | '2xlarge';
  /** Default claim lease in seconds (default 300); the node reaps the sandbox after it */
  ttlSeconds?: number;
  /** HTTP request timeout in milliseconds (default 120000) */
  requestTimeoutMs?: number;
}
```

### Create options

- `templateId` (or `image`) picks the template, e.g. `node-rt:24.04`, `python-rt:3.12`, `rt:24.04`.
- `size` picks a tier by name. Without it, `vcpus`/`cpus`/`cpu` and `memoryMb`/`memoryMiB`/`memMiB`/`memory` map to the smallest tier that covers the request:

| size | CPU | memory |
|---|---|---|
| `small` | 1 | 512 MB |
| `medium` | 2 | 1 GB |
| `large` | 4 | 4 GB |
| `xlarge` | 4 | 8 GB |
| `2xlarge` | 8 | 16 GB |

- `timeout` (milliseconds) becomes the claim lease, capped at 24 hours.

A claim is served from the node's warm pool for `(template, net, size)`; a request outside the configured pools cold-boots the template, which takes longer.

## Features

- ✅ **Command Execution** - commands run as root through `bash -c` over the sandboxd agent relay, with native `cwd`, `env`, streaming `onStdout`/`onStderr`, `background`, and `timeout`
- ✅ **Filesystem Operations** - shell-backed `readFile`, `writeFile`, `mkdir`, `readdir`, `exists`, `remove`
- ✅ **Preview URLs** - `getUrl` mints a signed preview URL when the node has a preview listener
- ✅ **Listing** - `list` and `getById` read the node's sandbox index

## Limitations

- sandboxd scopes a sandbox to the token minted at claim time. `destroy` and `runCommand` on a sandbox obtained through `getById` or `list` work only for sandboxes this process created; other sandboxes need the node API token.
- A node in a cluster may answer a claim with a redirect to a peer; this provider refuses it. Point `baseUrl` at a node that serves the pool.
- Snapshots and templates are managed through sandboxd's own API (checkpoints, promote) and are not exposed here.
