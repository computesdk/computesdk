---
description: >-
  Prime Intellect provider for ComputeSDK - VM and container sandboxes with command execution and port exposure.
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

# Prime Intellect

Run commands in [Prime Intellect](https://www.primeintellect.ai/) VM or container sandboxes through ComputeSDK.

## Installation & Setup

```bash
npm install @computesdk/prime
```

Set `PRIME_API_KEY`. Set `PRIME_TEAM_ID` to use a team account. The provider does not read the Prime CLI config file.

## Usage

```typescript
import { prime } from '@computesdk/prime';

const compute = prime({
  apiKey: process.env.PRIME_API_KEY,
  teamId: process.env.PRIME_TEAM_ID,
});

const sandbox = await compute.sandbox.create();
try {
  console.log((await sandbox.runCommand('node -v')).stdout);
} finally {
  await sandbox.destroy();
}
```

## Configuration

The default sandbox is a `node:22-bookworm` VM with 1 vCPU, 1 GB RAM, 10 GB disk, and a 60-minute lifetime. Pass `image`, `cpuCores`, `memoryGb`, `diskSizeGb`, or `timeoutMinutes` to `sandbox.create()` to change these. Pass `vm: false` for container mode. The `baseUrl` provider option defaults to `https://api.primeintellect.ai` and can also be set through `PRIME_API_BASE_URL` or `PRIME_BASE_URL`.

The provider supports sandbox creation, retrieval, listing, deletion, command execution, metadata, and port URLs. Filesystem and template operations are not implemented. Requires Node.js 20 or later.
