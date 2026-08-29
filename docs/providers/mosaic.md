---
description: >-
  Mosaic provider for ComputeSDK - Firecracker-based sandbox environments with command execution.
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

# Mosaic

Mosaic provides Firecracker-based sandbox environments with command execution, a workspace filesystem, preview URLs, snapshots, and environments built from container images.

## Installation and setup

```bash
npm install computesdk @computesdk/mosaic
```

Set the API endpoint and bearer token:

```bash
export MOSAIC_API_URL=https://your-mosaic-api.example.com
export MOSAIC_API_TOKEN=your_mosaic_token
```

## Usage

```typescript
import { compute } from 'computesdk';
import { mosaic } from '@computesdk/mosaic';

compute.setConfig({
  provider: mosaic({
    baseUrl: process.env.MOSAIC_API_URL,
    apiKey: process.env.MOSAIC_API_TOKEN,
  }),
});

const sandbox = await compute.sandbox.create({
  templateId: 'node-20',
  memoryMb: 4096,
  vcpus: 2,
});

const result = await sandbox.runCommand('node --version');
console.log(result.stdout);

await sandbox.destroy();
```

## Configuration options

The provider accepts `baseUrl`, `apiKey`, `template`, `memoryMb`, `vcpu`, `requestTimeoutMs`, `networkEnabled`, and `previewExpiresInSeconds`. If `baseUrl` or `apiKey` is omitted, the provider reads `MOSAIC_API_URL` or `MOSAIC_API_TOKEN`. Sandboxes have outbound network access unless `networkEnabled` is set to `false`.

## Templates, snapshots, and images

`node-20` and `python-3.11` are Mosaic's stock templates. Anything else — a `templateId` that is not stock, a `snapshotId`, or an `image` — is one of your own environments, addressed by id or by the name you gave it.

```typescript
const provider = mosaic({});

// Build an environment from any linux/amd64 registry image. Minutes, once.
await provider.template.create({ name: 'my-env', image: 'python:3.12-slim' });

// Sandboxes from it restore in about a second, like any other template.
const sandbox = await compute.sandbox.create({ templateId: 'my-env' });

// Or checkpoint a sandbox you have already set up.
await provider.snapshot.create(sandbox.sandboxId, { name: 'my-toolchain' });
await compute.sandbox.create({ snapshotId: 'my-toolchain' });
```

`template.create` also takes `retentionSeconds` and `registryUsername`/`registryPassword` for a private image. Registry credentials are used for that single pull and are never stored.

## Supported operations

`create`, `getById`, `list`, `destroy`, `runCommand`, `getInfo`, `getUrl`, the filesystem helpers, and the snapshot and template managers are all supported.

`background: true` starts a durable process rather than a backgrounded shell job, so a dev server outlives the request that started it; the returned `stdout` is the process id. Filesystem calls inside `/workspace` use Mosaic's binary-safe files API and paths outside it fall back to the shell. Images must be `linux/amd64` and contain `/bin/sh`, so distroless and scratch images are refused.
