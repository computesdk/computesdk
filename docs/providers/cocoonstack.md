---
description: >-
  Cocoon Stack provider for ComputeSDK - self-hosted microVM sandboxes served
  from warm pools by sandboxd, with command execution, filesystem access, and
  preview URLs.
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

# Cocoon Stack

[Cocoon Stack](https://github.com/cocoonstack/sandbox) provider for ComputeSDK - self-hosted microVM sandboxes served from warm pools by sandboxd, the sandbox control plane of the Cocoon Stack.

## Installation & Setup

```bash
npm install @computesdk/cocoonstack
```

Add your sandboxd endpoint and API token to a `.env` file:

```bash
COCOONSTACK_API_URL=https://sandbox.example.com
COCOONSTACK_API_KEY=your_api_token
```

The endpoint is a sandboxd node you run yourself; see the [deployment guide](https://github.com/cocoonstack/sandbox/blob/main/docs/deploy.md) for pools, tenants, and TLS.

## Usage

```typescript
import { cocoonstack } from '@computesdk/cocoonstack';

const compute = cocoonstack({
  baseUrl: process.env.COCOONSTACK_API_URL,
  apiKey: process.env.COCOONSTACK_API_KEY,
});

// Create sandbox (uses the default template from config)
const sandbox = await compute.sandbox.create();

// Or pick a template and a size at create time
const sandbox2 = await compute.sandbox.create({
  templateId: 'python-rt:3.12',
  vcpus: 4,
  memoryMb: 4096,
});

// Run a command
const result = await sandbox.runCommand('node -v');
console.log(result.stdout);

// Work with files
await sandbox.filesystem.writeFile('/tmp/hello.py', 'print("Hello World")');
const content = await sandbox.filesystem.readFile('/tmp/hello.py');

// Clean up
await sandbox.destroy();
```

### Configuration Options

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
  /** Default claim lease in seconds (default 300) */
  ttlSeconds?: number;
  /** HTTP request timeout in milliseconds (default 120000) */
  requestTimeoutMs?: number;
}
```

### Size tiers

`size` picks a tier by name. Without it, `vcpus`/`cpus`/`cpu` and `memoryMb`/`memoryMiB`/`memMiB`/`memory` map to the smallest tier that covers the request.

| size | CPU | memory |
|---|---|---|
| `small` | 1 | 512 MB |
| `medium` | 2 | 1 GB |
| `large` | 4 | 4 GB |
| `xlarge` | 4 | 8 GB |
| `2xlarge` | 8 | 16 GB |

A claim is served from the node's warm pool for `(template, net, size)`; a request outside the configured pools cold-boots the template. `timeout` on create becomes the claim lease in seconds, capped at 24 hours.

## Limitations

- sandboxd scopes a sandbox to the token minted at claim time, so `getById` and `list` return only the sandboxes this process claimed; `destroy` by id also works with a node token.
- A command without an explicit `timeout` is bounded by `requestTimeoutMs` (120 s by default); tokens travel as bearer headers, so use an `https://` endpoint outside a private network.
- A clustered node may redirect a claim to a peer; the provider refuses the redirect. Point `baseUrl` at a node that serves the pool.
- Snapshots and templates are managed through sandboxd's own API and are not exposed here.
