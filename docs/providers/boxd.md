---
description: >-
  boxd provider for ComputeSDK - isolated KVM microVM sandboxes with command
  execution, filesystem access, and HTTPS port URLs.
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

[boxd](https://boxd.sh) provider for ComputeSDK. Each sandbox is an isolated boxd machine — a KVM microVM with its own kernel, network stack, and disk — driven through the official [`@boxd-sh/sdk`](https://www.npmjs.com/package/@boxd-sh/sdk).

## Installation

```bash
npm install @computesdk/boxd
```

Requires Node.js 20 or newer.

## Setup

Create an API key in the [boxd console](https://app.boxd.sh) or with the CLI (`boxd auth keys create <name>`) and export it:

```bash
export BOXD_API_KEY=bxd_your_api_key
```

## Usage

```typescript
import { boxd } from '@computesdk/boxd';

const compute = boxd({ apiKey: process.env.BOXD_API_KEY });

const sandbox = await compute.instances.create();

const result = await sandbox.runCommand('echo "Hello from boxd!"');
console.log(result.stdout);

await sandbox.filesystem.writeFile('/tmp/hello.txt', 'Hello World');
console.log(await sandbox.filesystem.readFile('/tmp/hello.txt'));

// Serve something on port 3000, then get its public HTTPS URL
await sandbox.runCommand('python3 -m http.server 3000', { background: true });
console.log(await sandbox.getUrl({ port: 3000 }));

await sandbox.destroy();
```

## Configuration

| Option | Environment variable | Default | Description |
|---|---|---|---|
| `apiKey` | `BOXD_API_KEY` | required | boxd API key (`bxd_...`) |
| `region` | `BOXD_REGION` | SDK default (`fra`) | Region for new machines (`fra` or `nyc`) |

## Behavior

- Every sandbox is created with `isolated: true`, so it cannot reach your other boxd machines or integrations.
- `create` waits until the machine is ready before returning.
- `name` sets the machine name (boxd generates one if omitted).
- `envs` sets machine-level environment variables.
- `timeout` (ms) maps to boxd's `deleteAfter`, so the machine is deleted automatically after that long.
- `snapshotId` (or `templateId`) restores the machine from a boxd snapshot by name or ID.
- `getUrl({ port })` creates a boxd HTTPS proxy route named `p<port>` and returns its URL. Calling it again for the same port reuses the route.

## Supported features

| Feature | Supported |
|---|---|
| Create / get / list / destroy | Yes |
| Run commands (env, cwd, background) | Yes |
| Filesystem | Yes (native boxd filesystem API) |
| Port URLs (`getUrl`) | Yes (boxd HTTPS proxies) |
| Snapshots API | No (restoring from an existing snapshot on create is supported) |
| Templates API | No |
| Streaming / interactive processes | No |
