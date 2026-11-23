# @computesdk/styne

[Styne](https://styne.ai) provider for ComputeSDK - microVM sandboxes with streaming command output, file transfer, snapshots that keep memory and running processes, saved templates and persistent volumes.

## Installation

```bash
npm install @computesdk/styne
```

## Setup

Create an API key on the **API keys** page of the Styne dashboard ([docs](https://docs.styne.ai/authentication)) and set it in your environment:

```bash
export STYNE_API_KEY=your_styne_api_key
```

## Usage

```typescript
import { styne } from '@computesdk/styne';

const sdk = styne({ apiKey: process.env.STYNE_API_KEY });

const sandbox = await sdk.instances.create();

const result = await sandbox.runCommand('echo $((6 * 7))');
console.log(result.stdout); // "42\n"

await sandbox.filesystem.writeFile('/root/notes.txt', 'hello');
console.log(await sandbox.filesystem.readFile('/root/notes.txt'));

await sandbox.destroy();
```

### With the ComputeSDK router

```typescript
import { compute } from 'computesdk';
import { styne } from '@computesdk/styne';

compute.setConfig({ provider: styne({ apiKey: process.env.STYNE_API_KEY }) });

const sandbox = await compute.instances.create();
```

## Configuration

| Option | Environment variable | Default | Description |
|---|---|---|---|
| `apiKey` | `STYNE_API_KEY` | - | Styne API key (required) |
| `apiUrl` | `STYNE_API_URL` | `https://api.styne.ai` | API base URL; must be `https://` (plain `http://` is accepted only for `localhost`) |
| `timeout` | - | 300000 | Sandbox lifetime in milliseconds when `create` gets no `timeout` |

## Create options

| Option | Description |
|---|---|
| `templateId` | Built-in template from `template.list()` (for example `default`, or `small`/`large`/`xlarge`) or a template saved with `template.create()` |
| `size` | `small`, `default`, `large` or `xlarge` (see [Standard sizes](#standard-sizes)); not with `snapshotId` or `image` |
| `snapshotId` | Saved snapshot to start from |
| `image` | Container image the account has prepared |
| `timeout` | Lifetime in milliseconds, up to 24 hours |
| `envs` | Environment variables for every command |
| `metadata`, `name` | String metadata; `name` is stored as `metadata.name` |
| `volumes` | Volumes to mount: `{ volume, mountPath, readOnly? }` |

## Standard sizes

`create({ sizeClass })` picks the Styne size of the standard size and sends it as `size`:

```typescript
const sandbox = await sdk.instances.create({ sizeClass: 'lg' });
console.log(sandbox.sizing); // { requested: { sizeClass: 'lg', ... }, resolved: { vcpus: 4, memoryMiB: 8192, diskMiB: 52224 }, ... }
```

| `sizeClass` | Styne `size` | vCPU | Memory (MiB) | Disk (MiB) |
|---|---|---:|---:|---:|
| `md` | `small` | 2 | 4096 | 52224 |
| `lg` | `default` | 4 | 8192 | 52224 |
| `xl` | `large` | 8 | 16384 | 113664 |
| `2xl` | `xlarge` | 16 | 32768 | 257024 |

- `xs` and `sm` (Styne has no 1-vCPU size) and `3xl` (above 16 vCPU) are `unsupported` and never boot another size.
- A sandbox has the size of what it starts from, so `sizeClass` with `snapshotId`, `image` or `templateId` is `unsupported`.
- `sizeClass` with the native `size` is a `conflict`.
- The plan limits the size: a size above it fails at create with Styne's `402 plan_required`; it never boots a smaller sandbox.

### CPU, memory and disk fields

The universal fields `vcpus` (or `cpus`), `memoryMiB` (or `memMiB`, `memoryMb`) and `diskMiB` (or `diskMb`), read in vCPUs and
MiB, boot the Styne size with exactly that many vCPUs and at least that memory and disk (with no vCPU count: the smallest size
that has them):

```typescript
const sandbox = await sdk.instances.create({ vcpus: 8, memoryMiB: 16384 }); // Styne size `large`
```

A request no Styne size gives exactly (1, 3 or 32 vCPU; 2 vCPU with 8 GiB; more than 16 vCPU / 32 GiB) rejects with
`InstanceSizeError` before any sandbox starts. These fields next to `sizeClass` or `size` are a `conflict`; with `snapshotId`,
`image` or `templateId` they are `unsupported`. Other providers' own fields (`cpu`, `memory`, `resources`, ...) are left to them.

## Features

- **Commands**: `runCommand` with live `onStdout`/`onStderr` streaming, `cwd`, `env`, `timeout` and `background`
- **Filesystem**: read, write, list and remove through the files API; `mkdir` and `exists` run in the shell
- **Snapshots**: `sdk.snapshot.create(sandboxId, { name })` saves memory, processes and disk without stopping the sandbox; start any number of sandboxes from it with `instances.create({ snapshotId })`
- **Templates**: `sdk.template.create({ name, image?, templateId? })` saves a start state; `template.list()` returns the built-in and saved templates
- **Volumes**: `sdk.volume.create({ name })`, mounted with `instances.create({ volumes: [{ volume, mountPath }] })`
- **Pause and resume** with memory kept, **lifetime extension** (`extendLifetime(ms)` keeps the sandbox alive for at least `ms` more and never shortens it), **port URLs** with `getUrl({ port })`, and `instances.list()` (all sandboxes, page by page)

```typescript
const base = await sdk.instances.create();
await base.runCommand('echo ready > /root/state');

const snapshot = await sdk.snapshot.create(base.instanceId, { name: 'ready' });
const clones = await Promise.all([1, 2, 3].map(() => sdk.instances.create({ snapshotId: snapshot.id })));
```

## Errors

API errors are thrown as `StyneApiError` with the HTTP `status`, the API's `code` (for example `resident_limit`) and the `requestId` to quote to support.

## Limitations

- A command stopped at its `timeout` reports exit code 124.
- Paused sandboxes are reported by `getInfo()` as `stopped`.
- Built-in templates cannot be deleted.
- `image` needs an image the account has prepared (see https://docs.styne.ai/images); a create of an image that is still being prepared is repeated for up to a minute.
- A sandbox with a mounted volume cannot be paused or snapshotted (`409`, "the sandbox has a volume mounted").
- A resume gives the sandbox the lifetime it was created with again, counted from the resume.
- `readdir` entries have no modification time, and symbolic links are listed as files.
- If `template.create()` saves the template but cannot destroy its source sandbox, it still returns the template; the sandbox ends when its lifetime runs out.
- Requests are sent again only when that is safe (never sent, idempotent, or a `429`/`503` the API asks to repeat); creates carry an `Idempotency-Key`, so a repeated create never starts a second sandbox.
- Calls about a sandbox go to the API host of its region (`<region>.api.styne.ai`, from the `domain` the API reports); creates and account-wide calls use `api.styne.ai`, and a custom `apiUrl` is used as given.
- A request that gets no answer for 2 minutes fails with `ETIMEDOUT`. Commands are not cut off this way: a command with a `timeout` gets 30 seconds beyond it, and a command without one has no limit.

## License

MIT
