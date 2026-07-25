# @computesdk/opencomputer

OpenComputer provider for ComputeSDK - create persistent cloud VMs, run commands, read/write files, expose preview URLs, and manage checkpoints through the ComputeSDK interface.

## Installation

```bash
npm install computesdk @computesdk/opencomputer
```

## Setup

Create an OpenComputer API key and set:

```bash
export OPENCOMPUTER_API_KEY=your_api_key_here
```

Optionally override the API URL:

```bash
export OPENCOMPUTER_API_URL=https://app.opencomputer.dev
```

## Quick Start

```typescript
import { compute } from 'computesdk';
import { opencomputer } from '@computesdk/opencomputer';

compute.setConfig({
  provider: opencomputer({ apiKey: process.env.OPENCOMPUTER_API_KEY }),
});

const sandbox = await compute.sandbox.create({ templateId: 'base' });

const result = await sandbox.runCommand('echo "Hello from OpenComputer"');
console.log(result.stdout);

await sandbox.filesystem.writeFile('/tmp/hello.txt', 'Hello ComputeSDK');
console.log(await sandbox.filesystem.readFile('/tmp/hello.txt'));

const url = await sandbox.getUrl({ port: 3000 });
console.log(url);

await sandbox.destroy();
```

## Configuration

```typescript
interface OpenComputerConfig {
  apiKey?: string;
  apiUrl?: string;
  template?: string;
  timeout?: number;
  envs?: Record<string, string>;
  metadata?: Record<string, string>;
  cpuCount?: number;
  memoryMB?: number;
  diskMB?: number;
  secretStore?: string;
  burst?: boolean;
  previewAuth?: { scheme?: 'bearer'; token?: 'auto' | string };
}
```

`timeout` uses ComputeSDK's millisecond convention and is converted to OpenComputer's seconds-based API.

## Features

- Command execution via OpenComputer exec
- Filesystem read, write, mkdir, list, exists, and remove
- Sandbox create, reconnect by ID, and destroy
- Preview URLs for sandbox ports
- Checkpoints through ComputeSDK snapshots

## Snapshots

OpenComputer checkpoints are scoped to a source sandbox. This provider returns snapshot IDs in the form `sandboxId:checkpointId` so ComputeSDK can later delete the checkpoint.

```typescript
const sandbox = await compute.sandbox.create();

const snapshot = await compute.snapshot.create(sandbox.sandboxId, {
  name: 'ready-state',
});

const clone = await compute.sandbox.create({ snapshotId: snapshot.id });

await compute.snapshot.delete(snapshot.id);
await clone.destroy();
await sandbox.destroy();
```

You can also pass a raw OpenComputer checkpoint ID to `compute.sandbox.create({ snapshotId })` when you only need to fork from it.

Snapshots default to OpenComputer `disk_only` checkpoints with `promoteToFull: true`. Override with `metadata: { kind: 'full' }` or `metadata: { promoteToFull: false }` when needed.
