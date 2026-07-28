# @computesdk/run-cloud

[Run Cloud](https://run.cloud) provider for ComputeSDK. Run commands inside fast Firecracker microVM sandboxes with configurable CPU, memory, and disk, native file reads, snapshots, and automatic idle pause.

## Installation

```bash
npm install computesdk @computesdk/run-cloud
```

Create an API key in the [Run Cloud dashboard](https://run.cloud) and export it:

```bash
export RUN_CLOUD_API_KEY=rc_live_your_key
```

`RUN_CLOUD_API_TOKEN` is supported as a backwards-compatible alias. Set `RUN_CLOUD_API_URL` only when targeting a custom Run Cloud deployment.

## Usage

```typescript
import { compute } from 'computesdk';
import { runCloud } from '@computesdk/run-cloud';

compute.setConfig({
  provider: runCloud({
    apiKey: process.env.RUN_CLOUD_API_KEY,
    cpu: 2,
    memory: 4096,
    disk: 40,
  }),
});

const sandbox = await compute.sandbox.create({
  templateId: 'runcloud/agent-base',
  name: 'agent-task',
});

const result = await sandbox.runCommand('node --version');
console.log(result.stdout);

await sandbox.filesystem.writeFile('/tmp/result.txt', result.stdout);
console.log(await sandbox.filesystem.readFile('/tmp/result.txt'));

const snapshot = await compute.snapshot.create(sandbox.sandboxId, {
  name: 'after-setup',
});

await sandbox.destroy();

const restored = await compute.sandbox.create({
  snapshotId: snapshot.id,
  name: 'restored-task',
});
```

The provider factory can also be used directly:

```typescript
const cloud = runCloud({ apiKey: process.env.RUN_CLOUD_API_KEY });
const sandbox = await cloud.sandbox.create({ cpu: 1, memory: 1024 });
```

## Configuration

```typescript
interface RunCloudConfig {
  apiKey?: string;
  apiUrl?: string;
  fetch?: typeof fetch;
  image?: string;
  cpu?: number;
  memory?: number;
  disk?: number;
  idlePauseSeconds?: number;
  timeout?: number;
  region?: string;
  orgId?: string;
  commandTimeout?: number;
  tunnelTtlSeconds?: number;
}
```

- `cpu` accepts fractional vCPU values.
- `memory` is measured in MiB.
- `disk` is the writable disk quota in GiB.
- `timeout` and `commandTimeout` are milliseconds.
- `tunnelTtlSeconds` controls public port URL lifetime and defaults to one hour.
- `idlePauseSeconds` is seconds; set it to `0` to disable automatic pause.
- `templateId` and `image` both select a registered Run Cloud OCI image.
- `snapshotId` restores a previously created Run Cloud snapshot.
- Per-create `cpu`, `memory`, `disk`, `idlePauseSeconds`, `timeoutSeconds`, `region`, `name`, `orgId`, and `idempotencyKey` override provider defaults.

Run Cloud does not currently support persistent sandbox-level `envs`. Pass command-scoped variables with:

```typescript
await sandbox.runCommand('echo "$MODEL"', {
  env: { MODEL: 'gpt-5' },
});
```

## Supported Operations

| Method | Supported | Notes |
|---|---|---|
| `create` | ✅ | Fresh image boot or snapshot restore; configurable CPU, memory, disk, region, idle pause, and lifetime. |
| `getById` | ✅ | Returns `null` when the sandbox does not exist. |
| `list` | ✅ | Lists running sandboxes visible to the API key. |
| `destroy` | ✅ | Idempotent when the sandbox is already gone. |
| `runCommand` | ✅ | Supports `cwd`, command-scoped env, timeouts, streaming callbacks, and detached background commands. |
| `getInfo` | ✅ | Refreshes state and resource metadata from Run Cloud. |
| `getUrl` | ✅ | Opens an expiring capability URL without making the sandbox persistent. |
| Filesystem | ✅ | Native reads; shell-backed write, mkdir, list, exists, and remove. |
| Snapshots | ✅ | Create, list, delete, and restore through `snapshotId`. |

`sandbox.getInstance()` returns a `RunCloudSandbox` handle containing the official `Client` and the latest native sandbox record.

Tunnel hostnames are random bearer capabilities. Do not write them to public logs.
They expire automatically and are removed when the tunnel or sandbox is deleted.
