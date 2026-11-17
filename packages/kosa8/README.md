# @computesdk/kosa8

[kosa8](https://kosa8.com) provider for ComputeSDK - cloud sandboxes where each sandbox runs in its own microVM with its own kernel, billed per second, with sleep and wake.

## Installation & Setup

```bash
npm install @computesdk/kosa8
```

Create an API key in the kosa8 Cloud dashboard at [app.kosa8.com](https://app.kosa8.com), then add it to a `.env` file:

```bash
KOSA8_API_KEY=your_kosa8_api_key
```

## Usage

```typescript
import { compute } from 'computesdk';
import { kosa8 } from '@computesdk/kosa8';

compute.setConfig({
  provider: kosa8({ apiKey: process.env.KOSA8_API_KEY }),
});

const sandbox = await compute.instances.create();

const result = await sandbox.runCommand('uname -r && echo "Hello from kosa8!"');
console.log(result.stdout);

await sandbox.destroy();
```

Or call the provider factory directly:

```typescript
import { kosa8 } from '@computesdk/kosa8';

const sdk = kosa8({ apiKey: process.env.KOSA8_API_KEY });

// See which templates your organization can start
console.log(await sdk.template.list());

const sandbox = await sdk.sandbox.create({ templateId: 'base', timeout: 30 * 60 * 1000 });
await sandbox.filesystem.writeFile('/tmp/hello.sh', 'echo $((6 * 7))');
console.log((await sandbox.runCommand('sh /tmp/hello.sh')).stdout); // "42\n"

// Sleep: the VM's memory and disk are snapshotted and its RAM freed. Wake restores it.
await sandbox.pause();
await sandbox.resume();

// Snapshot: memory (running processes) and disk, saved while the sandbox keeps running.
// Each restore is a new sandbox that starts exactly where the snapshot was taken.
const snap = await sdk.snapshot.create(sandbox.sandboxId);
await sandbox.destroy();
const clone = await sdk.sandbox.create({ snapshotId: snap.id });
await clone.destroy();
await sdk.snapshot.delete(snap.id);

// Boot an OCI image (a VM of its own, 2 vCPU / 4 GiB by default)
const py = await sdk.sandbox.create({ image: 'python:3.12-slim' });
await py.destroy();
```

## Configuration

```typescript
interface Kosa8Config {
  /** kosa8 Cloud API key - if not provided, will use KOSA8_API_KEY env var */
  apiKey?: string;
  /** API base URL - defaults to KOSA8_API_URL, then https://api.kosa8.com */
  baseUrl?: string;
  /** Default template for new sandboxes - defaults to KOSA8_TEMPLATE, then the organization's default (`base`, no Node) */
  template?: string;
  /** Default region for new sandboxes, e.g. `eu-hel1` - defaults to KOSA8_REGION, then any region */
  region?: string;
}
```

## Create Options

| Option | Maps to | Notes |
|---|---|---|
| `templateId` | `template` | A template key from `template.list()`. The template sets the sandbox's vCPUs, memory and image. |
| `region` | `region` | A region id such as `eu-hel1`. |
| `timeout` (ms) | `ttl_s` | The sandbox is deleted when its lifetime ends. Rounded up to whole seconds; the API's minimum is 60 s and maximum 90 days. Without it, a sandbox lives until destroyed. |
| `sleepAfterSeconds` | `sleep_after_s` | Idle seconds before the sandbox sleeps; `0` never sleeps. |
| `image` | `image` | An OCI image reference such as `node:22`. The sandbox boots a VM of its own (2 vCPU / 4 GiB) from it, and `create` resolves once it runs. Needs a payment method on the organization. The configured default template does not apply. |
| `snapshotId` | `snapshot` | A snapshot from `snapshot.create()`. The new sandbox is restored from it, memory and disk, on the snapshot's host, and takes its template, size and image from it, so `templateId`, `image` and `region` are refused with it. |

`cpu`, `memory`, disk sizes, `envs` and `volumes` are rejected with an error rather than ignored: a sandbox's size comes from its template or image. Pass environment variables per command with `runCommand(cmd, { env })`.

## Features

- **Command execution** with `cwd`, `env`, `timeout` and background commands
- **Filesystem**: read, write, list, mkdir, exists and remove. File content moves through kosa8's file API: one request for a file under `/workspace` up to 8 MiB, and parallel 2 MiB parts staged under `/workspace` for larger files and other paths. Small files, and every operation on a host without the file API, are shell commands over exec.
- **Snapshots**: `snapshot.create(sandboxId)` saves the sandbox's memory and disk while it keeps running; `sandbox.create({ snapshotId })` restores it, as many times as you like, including after the source is destroyed. `snapshot.list()` and `snapshot.delete(id)` manage them.
- **Pause and resume**: `pause()` puts the sandbox to sleep (memory and disk are snapshotted, its RAM is freed) and `resume()` wakes it. A command or file call sent to a sleeping sandbox also wakes it, so `getInfo()` reports a sleeping sandbox as `running`.
- **Lifetime**: `extendLifetime(ms)` moves the delete time of a sandbox created with `timeout`
- **Templates**: `template.list()` returns the templates your organization can start, with their size and regions

## Limitations

- `getUrl()` (port URLs) is not supported yet and throws.
- Output is returned when the command finishes; there is no live streaming.
- `runCommand`'s `timeout` stops the command inside the sandbox with `timeout -s KILL` and reports exit code 124. On an image without the `timeout` utility, the command runs to completion.
- Templates are offered by kosa8's hosts, so `template.create()` and `template.delete()` throw.
- A snapshot is kept on the host its source ran on, and sandboxes restored from it are placed on that host.
- Volumes are not supported.
- Sandboxes created without `timeout` live until destroyed, so always call `destroy()` when you are done.

## Links

- [kosa8](https://kosa8.com)
- [Cloud dashboard](https://app.kosa8.com)

## Logos

SVG logos for results pages and docs are in [`assets/`](./assets):

| File | Use |
|---|---|
| `kosa8-logo-light.svg` | Mark and wordmark, for light backgrounds |
| `kosa8-logo-dark.svg` | Mark and wordmark, for dark backgrounds |
| `kosa8-mark.svg` | Square mark alone (icons, tables) |
