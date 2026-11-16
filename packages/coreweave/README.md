# @computesdk/coreweave

[CoreWeave Sandboxes](https://docs.coreweave.com/products/sandboxes) provider for ComputeSDK - isolated container sandboxes on CoreWeave capacity, driven through CoreWeave's official [`@coreweave/cwsandbox`](https://www.npmjs.com/package/@coreweave/cwsandbox) SDK.

## Installation & Setup

```bash
npm install @computesdk/coreweave
```

Requires Node.js 22 or newer (a requirement of `@coreweave/cwsandbox`). Create a CoreWeave API access token, then add it to a `.env` file:

```bash
CWSANDBOX_API_KEY=your_coreweave_api_token
# Optional, defaults to https://api.cwsandbox.com
CWSANDBOX_BASE_URL=https://api.cwsandbox.com
```

## Usage

```typescript
import { compute } from 'computesdk';
import { coreweave } from '@computesdk/coreweave';

compute.setConfig({
  provider: coreweave({ apiKey: process.env.CWSANDBOX_API_KEY }),
});

const sandbox = await compute.instances.create();

const result = await sandbox.runCommand('echo "Hello from CoreWeave!"');
console.log(result.stdout);

await sandbox.destroy();
```

Or call the provider factory directly:

```typescript
import { coreweave } from '@computesdk/coreweave';

const sdk = coreweave({ image: 'python:3.11', cpu: 1, memory: 1024 });

const sandbox = await sdk.sandbox.create({ ports: [8000], timeout: 30 * 60 * 1000 });
await sandbox.filesystem.writeFile('/app/hello.py', 'print(6 * 7)');
console.log((await sandbox.runCommand('python /app/hello.py')).stdout); // "42\n"

await sandbox.runCommand('python -m http.server 8000', { background: true });
console.log(await sandbox.getUrl({ port: 8000 }));

await sandbox.destroy();
```

Snapshots capture the snapshot volume mounted at `/work`:

```typescript
const source = await sdk.sandbox.create({ snapshotVolume: true });
await source.runCommand('echo saved > /work/state.txt');

const snapshot = await sdk.snapshot.create(source.sandboxId);
const restored = await sdk.sandbox.create({ snapshotId: snapshot.id });
console.log((await restored.runCommand('cat /work/state.txt')).stdout); // "saved\n"
```

## Configuration

```typescript
interface CoreWeaveConfig {
  /** CoreWeave API access token - if not provided, will use CWSANDBOX_API_KEY env var */
  apiKey?: string;
  /** Sandbox API endpoint - defaults to CWSANDBOX_BASE_URL, then https://api.cwsandbox.com */
  baseUrl?: string;
  /** Default container image - the SDK default is python:3.11 */
  image?: string;
  /** Default CPU cores */
  cpu?: number;
  /** Default memory in MiB */
  memory?: number;
  /** Default maximum sandbox lifetime in milliseconds */
  timeout?: number;
  /** Mount a snapshot volume on every sandbox (also a per-create option) */
  snapshotVolume?: boolean;
  /** Where the snapshot volume is mounted - defaults to /work */
  snapshotMountPath?: string;
  /** Snapshot volume size, e.g. '10Gi' - omit for the platform default */
  snapshotVolumeSize?: string;
  // Control plane for template management (default https://api.coreweave.com)
  controlPlaneUrl?: string;
}
```

## Create Options

| Option | Maps to | Notes |
|---|---|---|
| `image` | `containerImage` | Any OCI image reference. |
| `cpu` | `resources.cpu` | Cores, e.g. `2`. |
| `memory` (MiB) | `resources.memory` | Sent as `<n>Mi`. |
| `timeout` (ms) | `maxLifetimeSeconds` | Rounded up to whole seconds. |
| `envs` | `environmentVariables` | Set for the whole sandbox. |
| `name` | `annotations.name` | |
| `ports` | `services` | Each port gets a public HTTPS endpoint, used by `getUrl()`. |
| `templateId` | `runFromTemplate()` | Starts from a CoreWeave sandbox template (UUID); the template supplies the image unless `image` is set. |
| `snapshotVolume` | `fileSystemSnapshot` | Mounts a scratch volume at `snapshotMountPath` (`/work`) that can be snapshotted. |
| `snapshotId` | `fileSystemSnapshot.restoreFromSnapshotId` | Starts a new sandbox with the snapshot restored at `snapshotMountPath`. |

Every sandbox is tagged `computesdk`, and `list()` returns only active sandboxes with that tag.

## Features

- **Command execution** with `cwd`, `env`, `timeout` and background commands
- **Filesystem**: native read and write; mkdir, list, exists and remove run as shell commands
- **Snapshots**: `snapshot.create(sandboxId)` archives the sandbox's snapshot volume (`/work` by default) and waits until it is ready; the sandbox keeps running. Restore with `create({ snapshotId })`, and the same snapshot can be restored into many sandboxes. `snapshot.list()` and `snapshot.delete()` manage your organization's snapshots.
- **Templates**: `template.create({ name, image })` (or `{ name, spec }` with a full CoreWeave partial sandbox spec), `template.list()` and `template.delete(id)` manage your organization's templates through the CoreWeave control plane (`/v1/sandboxTemplates`). Creating and deleting need the **Sandbox Admin** role. Start a sandbox from one with `create({ templateId })`. Deletes are soft: existing sandboxes are unaffected.
- **Port URLs**: `getUrl({ port })` returns the public HTTPS URL of a port requested at create
- **Native SDK access**: `sandbox.getInstance()` returns the `@coreweave/cwsandbox` `Sandbox`, for streaming and other native APIs

## Limitations

- Output is returned when the command finishes; there is no live streaming through this provider.
- `runCommand`'s `timeout` is a client-side deadline: the call fails when it passes, but the command is not killed inside the sandbox.
- Background commands run detached with `nohup` and their output is discarded.
- Snapshots capture only the snapshot volume, not the rest of the container filesystem or memory, and only sandboxes created with `snapshotVolume: true` (or restored from a snapshot) can be snapshotted. The capture is not atomic: writes during `snapshot.create()` may be missed.
- Pause/resume and template updates (`PATCH`) are not exposed through this provider.
- Templates have no description or metadata fields, so passing those to `template.create()` throws.
- Sandboxes live until destroyed or until their maximum lifetime, so always call `destroy()` when you are done.

## Links

- [CoreWeave Sandboxes docs](https://docs.coreweave.com/products/sandboxes)
- [`@coreweave/cwsandbox` on npm](https://www.npmjs.com/package/@coreweave/cwsandbox)
