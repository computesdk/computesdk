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

## Standard sizes

`sizeClass` boots an exact CPU/RAM shape, sent as `vcpu`/`memory_mb` on create:

```typescript
const sandbox = await compute.instances.create({ sizeClass: 'xl' })
```

| `sizeClass` | Shape | How |
| --- | --- | --- |
| `xs` | 1 vCPU / 1 GiB | Environment `csdk-node22-1cpu-1gb` (built by [Provider Setup](../../ADD-PROVIDER.md#provider-setup)) |
| `sm` | 1 vCPU / 2 GiB | Configured stock template |
| `md` | 2 vCPU / 4 GiB | Configured stock template |
| `lg` | 4 vCPU / 8 GiB | Configured stock template |
| `xl` | 8 vCPU / 16 GiB | Template `base` |
| `2xl` | 16 vCPU / 32 GiB | Template `base` |
| `3xl` | — | `unsupported`: Mosaic's largest shape is 16 vCPU / 32 GiB |

Mosaic's create shapes are 1/2, 2/4, 4/8, 8/16 and 16/32 vCPU/GiB; every stock template serves 1, 2 and 4 vCPU, and only `base` serves 8 and 16. `xs` has no create shape, so it boots an environment built at 1 vCPU / 1024 MiB (environments take 1-16 vCPU and 512-32768 MiB); override its name with `sizeTemplates`. A `sizeClass` is refused (`unsupported`) with `snapshotId`, `image` or an environment `templateId` (they restore at their captured shape), with a stock `templateId` other than `base` for `xl`/`2xl`, and with any `templateId` for `xs`. Combining it with native `vcpus`/`vcpu`/`memoryMb`/`memory_mb` is a `conflict`. See [Sandbox sizes](../reference/sizes.md).

## Account sizes and lifecycle

`pause()`/`resume()` preserve memory and processes. Snapshots declare whole-rootfs and memory preservation with the source kept; restore with `snapshotId`.

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

const sandbox = await compute.instances.create({
  templateId: 'node-20',
  memoryMb: 4096,
  vcpus: 2,
});

const result = await sandbox.runCommand('node --version');
console.log(result.stdout);

await sandbox.destroy();
```

## Configuration options

The provider accepts `baseUrl`, `apiKey`, `template`, `memoryMb`, `vcpu`, `requestTimeoutMs`, `networkEnabled`, `previewExpiresInSeconds`, and `sizeTemplates` (environment per `sizeClass`; defaults to `MOSAIC_SIZE_TEMPLATES`). If `baseUrl` or `apiKey` is omitted, the provider reads `MOSAIC_API_URL` or `MOSAIC_API_TOKEN`. Sandboxes have outbound network access unless `networkEnabled` is set to `false`.

## Templates, snapshots, and images

`node-20` and `python-3.11` are Mosaic's stock templates. Anything else — a `templateId` that is not stock, a `snapshotId`, or an `image` — is one of your own environments, addressed by id or by the name you gave it.

```typescript
const provider = mosaic({
  baseUrl: process.env.MOSAIC_API_URL,
  apiKey: process.env.MOSAIC_API_TOKEN,
});

// Build an environment from any linux/amd64 registry image. Minutes, once.
await provider.template.create({ name: 'my-env', image: 'python:3.12-slim' });

// Sandboxes from it restore in about a second, like any other template.
const sandbox = await compute.instances.create({ templateId: 'my-env' });

// Or checkpoint a sandbox you have already set up.
await provider.snapshot.create(sandbox.instanceId, { name: 'my-toolchain' });
await compute.instances.create({ snapshotId: 'my-toolchain' });
```

`template.create` also takes `retentionSeconds` and `registryUsername`/`registryPassword` for a private image. Registry credentials are used for that single pull and are never stored.

## Supported operations

`create`, `getById`, `list`, `destroy`, `runCommand`, `getInfo`, `getUrl`, the filesystem helpers, and the snapshot and template managers are all supported.

`background: true` starts a durable process rather than a backgrounded shell job, so a dev server outlives the request that started it; the returned `stdout` is the process id. Filesystem calls inside `/workspace` use Mosaic's binary-safe files API and paths outside it fall back to the shell. Images must be `linux/amd64` and contain `/bin/sh`, so distroless and scratch images are refused.
