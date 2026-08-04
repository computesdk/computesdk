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

Mosaic provides Firecracker-based sandbox environments with command execution and explicit resource sizing.

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

The provider accepts `baseUrl`, `apiKey`, `template`, `memoryMb`, `vcpu`, and `requestTimeoutMs`. If `baseUrl` or `apiKey` is omitted, the provider reads `MOSAIC_API_URL` or `MOSAIC_API_TOKEN`.

## Supported operations

`create`, `getById`, `list`, `destroy`, `runCommand`, and `getInfo` are supported. Preview URLs and the ComputeSDK filesystem helpers are not currently implemented; use `runCommand` for file operations.
