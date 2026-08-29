# OpenComputer

OpenComputer provides persistent cloud VMs with command execution, filesystem access, preview URLs, and checkpoints.

## Installation

```bash
npm install computesdk @computesdk/opencomputer
```

## Environment Variables

```bash
export OPENCOMPUTER_API_KEY=your_api_key_here
# Optional
export OPENCOMPUTER_API_URL=https://app.opencomputer.dev
```

## Usage

```typescript
import { compute } from 'computesdk';
import { opencomputer } from '@computesdk/opencomputer';

compute.setConfig({
  provider: opencomputer({ apiKey: process.env.OPENCOMPUTER_API_KEY }),
});

const sandbox = await compute.sandbox.create({ templateId: 'base' });

const result = await sandbox.runCommand('node --version');
console.log(result.stdout);

await sandbox.destroy();
```

## Options

```typescript
opencomputer({
  apiKey: process.env.OPENCOMPUTER_API_KEY,
  apiUrl: process.env.OPENCOMPUTER_API_URL,
  template: 'base',
  timeout: 300_000,
  memoryMB: 4096,
  cpuCount: 2,
  diskMB: 20480,
  burst: true,
});
```

Per-create options such as `templateId`, `timeout`, `envs`, `metadata`, `memory`, `memoryMB`, `cpuCount`, `diskMB`, `secretStore`, `burst`, `previewAuth`, and `webhooks` are forwarded to OpenComputer where supported.

## Snapshots

ComputeSDK snapshots map to OpenComputer checkpoints:

```typescript
const snapshot = await compute.snapshot.create(sandbox.sandboxId, {
  name: 'configured',
});

const clone = await compute.sandbox.create({ snapshotId: snapshot.id });

await compute.snapshot.delete(snapshot.id);
```

Snapshot IDs returned by this provider are formatted as `sandboxId:checkpointId` because OpenComputer deletes checkpoints under their source sandbox. Raw OpenComputer checkpoint IDs are also accepted when creating a sandbox from a checkpoint.

Snapshots default to OpenComputer `disk_only` checkpoints with `promoteToFull: true`. Override with `metadata: { kind: 'full' }` or `metadata: { promoteToFull: false }` when needed.
