# @computesdk/groundbox

[Groundbox](https://groundbox.dev) provider for ComputeSDK. Each instance is a sandbox in its own Firecracker VM, built on the official [`@groundbox/sdk`](https://www.npmjs.com/package/@groundbox/sdk) client.

## Installation

```bash
npm install @computesdk/groundbox
```

Needs Node 20 or later. Live output (`onStdout`, `onStderr`) and `startProcess` use a WebSocket: Node 22 has one built in; on Node 20, pass one in the config, for example the one from the `ws` package.

## Setup

Create an API key in the [Groundbox dashboard](https://app.groundbox.dev/keys), then set it:

```bash
GROUNDBOX_API_KEY=gbx_your_api_key
```

The key needs the `sandboxes:read` and `sandboxes:write` scopes.

Sandboxes need the paid plan ($20 a month) or the free trial a new account starts with. The free plan has no sandboxes: on it, `create` fails with `paid_plan_required`. The trial has $1 of usage and runs up to two sandboxes at once, each of at most 2 vCPUs and 4 GB for an hour; previews (`getUrl`), kept snapshots, volumes, templates and `on_timeout` other than `delete` need the paid plan.

## Usage

```typescript
import { groundbox } from '@computesdk/groundbox';

const compute = groundbox({ apiKey: process.env.GROUNDBOX_API_KEY });

const sandbox = await compute.instances.create({ sizeClass: 'md', timeout: 30 * 60_000 });

const result = await sandbox.runCommand('echo "Hello from Groundbox!"');
console.log(result.stdout);

// Output as it is printed. A command gets 60 seconds unless it is given a timeout.
await sandbox.runCommand('mkdir -p app && cd app && npm init -y && npm install left-pad', {
  timeout: 5 * 60_000,
  onStdout: (text) => process.stdout.write(text),
});

await sandbox.filesystem.writeFile('/tmp/hello.txt', 'hi');

// An HTTPS URL for a port
const url = await sandbox.getUrl({ port: 3000 });

await sandbox.destroy();
```

## Configuration

```typescript
interface GroundboxConfig {
  /** Groundbox API key (gbx_...). Falls back to the GROUNDBOX_API_KEY environment variable. */
  apiKey?: string;
  /** API base, ending in /v1. Falls back to GROUNDBOX_API_URL, then https://api.groundbox.dev/v1. */
  baseUrl?: string;
  /** What getUrl makes: 'private' (the default) or 'public'. See Preview URLs. */
  previews?: 'private' | 'public';
  /** Custom HTTP transport. */
  fetch?: typeof fetch;
  /** The WebSocket live output and startProcess use. Defaults to the runtime's own (Node 22 has one). */
  WebSocket?: typeof WebSocket;
}
```

Without a key, the first call fails with the setup steps.

## Create options

| Option | Notes |
|---|---|
| `sizeClass` | `xs`, `sm`, `md`, `lg` or `xl`. See Sizes |
| `cpus`, `memory_gb`, `disk_gb` | Groundbox's own size fields: 1 to 16 vCPUs, whole GB of memory up to 4 GB per vCPU, disk 1 to 100 GB. Default 2 vCPUs, 4 GB, 20 GB disk. A team runs at most two sandboxes of more than 8 vCPUs at once |
| `timeout` | Lifetime in milliseconds, rounded up to whole minutes. Default one hour, 30 days at most |
| `on_timeout` | What the auto-stop does: `delete` (the default), or `stop` (keep the disk) or `pause` (keep memory too) so the sandbox can come back. Paid plan |
| `envs` | Environment variables for every command |
| `metadata` | Labels. Values that are not strings are stored as JSON. `name` is stored as the `name` label |
| `templateId` | A template's id (`tpl_...`), name or `name:version` |
| `image` | A Docker image to start from, such as `node:22-slim`, with no template made first. The first sandbox from an image is queued while the image is turned into a disk, and `create` waits for it |
| `snapshotId` | A kept snapshot (`snap_...`) to start from: see Snapshots. The sandbox has the snapshot's size |
| `volumes` | `{ volume, mountPath, readOnly? }` mounts, four at most. See Volumes |
| `allow_hosts` | Egress allowlist: host names, wildcards (`*.npmjs.org`), IPv4 addresses and IPv4 networks |
| `deny_hosts` | Egress deny list, in the same form: everything but these. With both lists, a denied entry wins |
| `secrets`, `env_from_secrets` | Team secrets given to every command as variables, by name: `secrets: ['NPM_TOKEN']`, or `env_from_secrets: { TOKEN: 'NPM_TOKEN' }` for another variable name. The key needs `secrets:use` |
| `flex` | For work that can wait: the sandbox starts when there is spare room, and may stay queued until then |
| `signal` | Cancels creation; an abort while `create` waits for the sandbox to run deletes it |

`snapshotId`, `image` and `templateId` name what the sandbox starts from: pass one at most. `create` returns once the sandbox runs, except for a `flex` sandbox, which may wait for room.

## Sizes

| `sizeClass` | vCPUs | Memory |
|---|---:|---:|
| `xs` | 1 | 1 GB |
| `sm` | 1 | 2 GB |
| `md` | 2 | 4 GB |
| `lg` | 4 | 8 GB |
| `xl` | 8 | 16 GB |

Each size is sent to the API as exactly that `cpus` and `memory_gb`. The API refuses a size it cannot give, and never rounds or replaces one. `2xl` (16 vCPUs, 32 GB) is `unknown` and fails before any request: Groundbox takes it, but it has not been booted and checked through this adapter. Pass `cpus: 16, memory_gb: 32` for it. `3xl` (32 vCPUs) is `unsupported`: a Groundbox sandbox has 16 vCPUs at most. A `sizeClass` cannot be combined with `cpus` or `memory_gb`.

`getInfo()` reports the size the VM itself measured once it booted, under `metadata.groundbox.booted` (`cpus`, and `memoryMiB` as the guest sees it, a little under the request because the guest kernel keeps some).

## Commands

- `runCommand` runs the command with `sh -c`. Options: `cwd`, `env`, `timeout`. A non-zero exit code is a result, not an error.
- The timeout is 60 seconds unless you pass one, rounded up to whole seconds, one hour at most. A command killed at its timeout comes back with a non-zero exit code.
- With `onStdout` or `onStderr`, output arrives as it is printed, over Groundbox's exec stream. The command keeps running if the connection drops, and the stream reconnects and reads on.
- `background: true` starts the command through Groundbox's commands API and returns exit code 0 at once. It runs on with nobody waiting, up to its `timeout` (one hour by default, 30 days at most); its output is kept in the sandbox, listed under `GET /v1/sandboxes/{id}/commands`.
- `startProcess` is native: the process runs on the exec stream as a resumable command, so it keeps running if the connection drops. `write` sends stdin (text or bytes), `status` and `wait` give the output so far and the exit code, and `kill(signal)` signals the process and everything it started: `SIGKILL` (the default), `SIGTERM`, `SIGINT`, `SIGHUP`, `SIGQUIT`, `SIGUSR1` or `SIGUSR2`. It ends when it exits, is killed, or when the sandbox ends.

## Files

`readFile`, `writeFile` and `readdir` use Groundbox's files API (`writeFile` makes parent folders). `mkdir` (with its parents), `exists` and `remove` (recursive) use the files API too. `readFile` returns UTF-8 text. `readdir` lists a symbolic link as a file.

## Preview URLs

`getUrl({ port })` gives the port an HTTPS URL of its own. By default the preview is private, and `getUrl` returns its share link: the URL with a `gb_token` query parameter that lets its holder in for 24 hours. With `previews: 'public'` in the config, the preview is open to anyone who has the URL, and `getUrl` returns the plain URL. `protocol: 'wss'` returns the same address as a WebSocket URL. A sandbox has ten previews at most.

## Pause, resume and lifetime

```typescript
await sandbox.pause();   // memory and disk are kept; billed for storage only
await sandbox.resume();  // processes are running again
await sandbox.extendLifetime(30 * 60_000); // auto-stop 30 minutes from now
```

A sandbox with volumes cannot be paused.

## Templates

```typescript
const template = await compute.template.create({
  name: 'python-ml',
  image: 'python:3.12-slim',
  pip: ['numpy', 'pandas'],
});
// The first version builds at once. Use the template when its status is 'ready'.
const sandbox = await compute.instances.create({ templateId: 'python-ml' });
```

`template.create` takes the name plus Groundbox's build fields: `image` or `dockerfile`, `apt`, `pip`, `npm`, `files`, `run`, `env`, `cpus`, `memory_gb`, `disk_gb`. `template.list()` and `template.delete(idOrName)` are supported.

## Volumes

```typescript
const volume = await compute.volume.create({ name: 'data', sizeBytes: 10 * 2 ** 30 });
const sandbox = await compute.instances.create({
  volumes: [{ volume, mountPath: '/data' }],
});
```

A volume's size is whole GB (`sizeBytes` is rounded up); with no size it is 10 GB. It is read-write in one sandbox at a time, or read-only in any number. `volume.get`, `volume.list` and `volume.delete` are supported. Volumes are attached at create time only, and need the paid plan.

## Snapshots

```typescript
const snapshot = await compute.snapshot.create(sandbox.instanceId, { name: 'before-migration' });
await compute.snapshot.waitUntilReady(snapshot.id);
const copy = await compute.instances.create({ snapshotId: snapshot.id });
await compute.snapshot.delete(snapshot.id);
```

A snapshot keeps a running sandbox's memory, processes and disk, and outlives the sandbox. The source keeps running. Any number of sandboxes can start from one snapshot, each with the snapshot's size. `snapshot.create` can return while the snapshot is still being made (status `creating`): call `waitUntilReady` before starting from it. `snapshot.list({ instanceId })` lists one sandbox's snapshots. `name` is stored as the snapshot's label; snapshots have no metadata. A sandbox with volumes cannot be snapshotted. Kept snapshots need the paid plan, and one that no sandbox has started from for 30 days is deleted.

## The native client

`instance.getInstance()` returns `{ id, client }`, where `client` is the `@groundbox/sdk` client. Use it for what ComputeSDK has no method for: forking a running sandbox, save points and rewind, desktops for computer-use agents. Stopping a sandbox with its disk kept is the client's `stop_sandbox` and `start_sandbox`; while a sandbox is shut down, `getInfo()` reports it as `stopped` and `getById` still finds it.

```typescript
const { id, client } = sandbox.getInstance();
const copy = await client.fork_sandbox(id);
```

## Limitations

- `runCommand` with `background: true` has no handle: use `startProcess` to read, wait for or stop a process.
- Commands are shell lines (`sh -c`); Groundbox's `args` (no shell) and terminal (`tty`) modes are reachable through the native client only.
- Sandboxes run Groundbox's image (Ubuntu 24.04, Linux amd64) unless a template or an image says otherwise.
