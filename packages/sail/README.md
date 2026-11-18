# @computesdk/sail

[Sail](https://sailresearch.com) provider for ComputeSDK. Sailboxes are
isolated Firecracker microVM sandboxes with command execution, native
filesystem operations, and public HTTP or TCP listeners.

## Installation

```bash
npm install computesdk @computesdk/sail
```

Node.js 22 or newer is required by the Sail SDK.

## Configuration

Create a Sail API key at [app.sailresearch.com](https://app.sailresearch.com),
then export it:

```bash
export SAIL_API_KEY=your_sail_api_key
```

The provider accepts:

```typescript
interface SailConfig {
  apiKey?: string;
  app?: string;
  image?: ImageSpec | Image;
}
```

- `apiKey` falls back to `SAIL_API_KEY`.
- `app` owns the created Sailboxes and falls back to `SAIL_APP`, then
  `computesdk`. It is created on first use when missing.
- `image` defaults to Sail's ARM64 Devbox builtin, which includes Node.js and
  Bun. Pass another Sail image when the workload needs a different runtime or
  architecture.
- Creates inherit Sail's image resource limits (8 vCPUs, 64 GiB memory limit,
  and 256 GiB disk limit by default). Explicit `size: 's' | 'm' | 'l'` and
  `memoryGib` options override those limits for that create; omitted options
  are not sent to Sail. You can also configure limits on the image:
  `sail({ image: Image.devbox('arm64').numCpus(4).memoryLimitGib(32) })`,
  importing `Image` from `@sailresearch/sdk`. These are resource limits;
  Sail bills actual CPU and memory consumption.

## Usage

```typescript
import { sail } from '@computesdk/sail';

const compute = sail({ app: 'my-app' });

const sandbox = await compute.instances.create();
const result = await sandbox.runCommand('node --version');
console.log(result.stdout);

await sandbox.filesystem.writeFile('/tmp/result.txt', result.stdout);
console.log(await sandbox.filesystem.readFile('/tmp/result.txt'));

await sandbox.destroy();
```

It can also be registered with ComputeSDK's shared client:

```typescript
import { compute } from 'computesdk';
import { sail } from '@computesdk/sail';

compute.setConfig({ provider: sail({ app: 'my-app' }) });
const sandbox = await compute.instances.create();
```

## Supported Operations

| Operation | Supported | Notes |
|---|---|---|
| `create` | Yes | ARM64 Devbox by default; supports OCI `image`, `envs`, `name`, explicit `size`/`memoryGib`, `timeout`, `volumes`, and cancellation. |
| `getById` | Yes | Returns `null` for missing or terminated Sailboxes. |
| `list` | Yes | Scoped to the configured app. |
| `destroy` | Yes | Terminates the Sailbox. |
| `runCommand` | Yes | Supports cwd, environment, timeout, and background mode. |
| `getInfo` | Yes | Refreshes current lifecycle state. |
| `getUrl` | Yes | Exposes or reuses HTTP/HTTPS and TCP listeners. |
| Filesystem | Yes | Native read, write, mkdir, list, exists, and remove. |
| OCI images | Yes | Pass `create({ image: 'node:22' })`, or configure a Sail `Image` on the provider. |
| Templates | No | No ComputeSDK template manager; use an image or checkpoint. |
| Volumes | Yes | Create, get, list, delete, and mount at create time; read-only mounts are supported. |
| Pause/resume | Yes | `pause()` holds the Sailbox in memory; files and running processes survive `resume()`. |
| Snapshots | Yes | Checkpoints keep the whole filesystem (including `/tmp`) and memory; the source keeps running. |

`getUrl` does not replace an existing listener because doing so would replace
its allowlist. A listener with a conflicting protocol produces an error.

ComputeSDK's create `timeout` is a positive lifetime in milliseconds, rounded
up to whole seconds and sent as Sail's `maxLifetimeSeconds`. It includes time
spent waiting for capacity, sleeping, and paused. Sail checks expiry periodically;
termination is not a millisecond-precise deadline. Omit it for unlimited lifetime.
This also works with `snapshotId`; other create-time environment overrides cannot
be combined with `snapshotId` because the checkpoint's environment is inherited.
Command `timeout` remains a separate execution limit.

## OCI images and persistent volumes

```typescript
const volume = await compute.volume.create({ name: 'shared-data' });
const sandbox = await compute.instances.create({
  image: 'node:22',
  envs: { NODE_ENV: 'production' },
  timeout: 60 * 60 * 1000,
  volumes: [{ volume, mountPath: '/data' }],
});
await sandbox.filesystem.writeFile('/data/result.txt', 'persisted');
await sandbox.destroy();
// The volume survives the sandbox; mount it in a new sandbox to reuse its files.
await compute.volume.delete(volume.id!);
```

OCI images are imported/built through Sail's imagebuilder. Reusable Sail image
builders and prebuilt image specs can still be passed through `sail({ image })`.
A create-time `image` overrides that provider default. Importing a custom image
can take longer than starting an existing builtin.

Volume references accept handles, names, or ids. Named mounts must already exist;
only `volume.create` mints a missing volume. Mount paths must be absolute, unique,
and absent or empty in the image. Set `readOnly: true` on a mount to prevent writes.
Volumes grow with their contents; fixed-size provisioning options are rejected.
Runtime attach/detach is not exposed by this adapter.

## Validation

Run `pnpm --filter @computesdk/sail test` for adapter tests. Live tests are skipped
without `SAIL_API_KEY`. With a dedicated test key and `SAIL_APP` set, the suite
also checks an OCI image's environment, persistence across two boxes, read-only
mounts, and a checkpoint restore. The tests create billable resources and clean
up their boxes, checkpoints, and volumes. A passing adapter suite does not imply
that ComputeSDK's separate private benchmark suites have been run.

Use `sandbox.getInstance()` for Sail-specific to-disk sleep, fork, SSH,
listener allowlist, and credential-injection APIs.
