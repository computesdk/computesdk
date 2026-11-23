# @computesdk/uno

[Uno](https://uno.place) provider for [ComputeSDK](https://www.computesdk.com).

Every Uno machine is a full Linux microVM on Firecracker, not a container: systemd, `apt`, passwordless `sudo` and a real disk. It boots from a warm snapshot in seconds. Machines in the **US region run on High-end servers**, on our fastest processors.

## Installation

```bash
npm install @computesdk/uno
```

## Setup

Create an API key in the Uno console (**Settings → API keys**) and add it to your environment:

```bash
UNO_API_KEY=your_uno_api_key
UNO_REGION=us        # optional: 'us' (High-end) or 'nl'; defaults to your account's region
```

Creating machines needs an Uno plan. Machine sizes fit inside your plan's limits (for example, 8 vCPU / 16 GiB needs Pro or Max).

## Usage

```typescript
import { uno } from '@computesdk/uno'

const compute = uno({ apiKey: process.env.UNO_API_KEY, region: 'us' })

const sandbox = await compute.sandbox.create({ vcpus: 8, memoryMiB: 16384 })

const result = await sandbox.runCommand('uname -a && nproc')
console.log(result.stdout)

await sandbox.filesystem.writeFile('/tmp/hello.txt', 'Hello from Uno')
console.log(await sandbox.filesystem.readFile('/tmp/hello.txt'))

await sandbox.destroy()
```

## Configuration

```typescript
interface UnoConfig {
  /** API key. Falls back to UNO_API_KEY. */
  apiKey?: string
  /** API base URL. Falls back to UNO_API_URL, then https://console.uno4.dev. */
  baseUrl?: string
  /** 'us' (High-end) or 'nl'. Falls back to UNO_REGION, then your account's region. */
  region?: string
  /** OS template: 'ubuntu-24.04' (default), 'ubuntu-22.04', 'debian-12'. */
  template?: string
  /** Defaults when create() does not say: 2 vCPU, 2048 MiB, 10 GB disk. */
  vcpu?: number
  ramMb?: number
  diskGb?: number
  /** How long create() waits for the machine to boot. Default 120 000 ms. */
  readyTimeoutMs?: number
}
```

`create()` reads the size from `vcpus` / `cpus` / `cpu`, `memoryMiB` / `memMiB` / `memoryMb` / `memory` and `diskMiB` / `diskMb`. Memory is rounded up to a multiple of 256 MiB. `templateId` selects the OS template.

## How commands run

- Commands run as user `uno` in a login `bash` shell, in the home directory. Use `sudo` for root.
- A command can run for up to 1 hour (`timeout`, default 5 minutes). Long commands are long-polled, so no single HTTP response hangs on proxy time limits. Retries use an idempotency key, so a dropped connection never starts a command twice.
- Up to 256 KiB of stdout and 64 KiB of stderr are returned per command; if either was cut, `stderr` ends with an `[uno] … truncated` line. Command text is limited to 64 KiB: write bigger inputs with `filesystem.writeFile` first.
- `filesystem.readFile` and `writeFile` use Uno's file API (one request per file; files over 64 MiB go as parts) where the API offers it, and shell commands otherwise: then a small file is one command, a large one moves in chunks. Either way there is no size limit, and `writeFile` replaces the file atomically: a failed write never leaves a partial file.
- One command runs on a machine at a time. Concurrent `runCommand` calls on the same machine from one provider instance are queued and start the moment the previous one ends; a command from elsewhere waits while the machine reports `BOX_BUSY`. For truly parallel jobs use one machine per job, or `background: true`.

## Supported

| Feature | |
|---|---|
| create / getById / list / destroy | ✅ |
| runCommand (cwd, env, timeout, background) | ✅ |
| filesystem (read, write, mkdir, readdir, exists, remove) | ✅ (file API where available, else shell) |
| pause / resume | ✅ paused in memory, resumed in milliseconds: memory and running processes survive |
| snapshots: create, list, delete, `create({ snapshotId })`, fork | ✅ disk only (see below) |
| getUrl | port 80 only, at `https://<name>.uno4.dev` |
| live output streaming, templates API, volumes | not yet |

## Pause and snapshots

- `instance.pause()` stops the machine where it runs and keeps its memory on the server; `resume()` picks up in milliseconds, so running processes carry on. A paused machine counts as running. After `pauseInMemoryS` seconds (default 300, set it in `uno({ pauseInMemoryS })`; `0` skips this step) it goes to sleep on disk on its own: it then uses no CPU or RAM, and `resume()` still brings back memory and processes. A command sent to a paused machine wakes it too.
- `snapshot.create(instanceId)` flushes the machine's writes to disk, copies the disk copy-on-write (the source is paused for milliseconds and keeps running) and leaves the copy stopped, without booting it. The snapshot is that stopped machine: it is named `computesdk-snapshot-…`, its id is the machine id, and it uses no CPU or RAM. `instances.list()` does not show it; `snapshot.list()` does.
- `instances.create({ snapshotId })` boots a new machine from a copy of the snapshot's disk, with the snapshot's shape; many instances can come from one snapshot. A live machine's id works as `snapshotId` too: that forks its current disk.
- Snapshots keep the disk, not memory: processes do not survive, and `/tmp` is emptied when an instance boots from the snapshot. Delete snapshots you no longer need with `snapshot.delete(id)`; each counts as a machine on your account while it exists.

## Links

- Uno: https://uno.place
- API reference: `GET https://console.uno4.dev/api/v1/openapi.yaml`

---

[Sandbox providers](https://www.computesdk.com/providers/sandboxes) · [Sandbox Router](https://www.computesdk.com/sandbox-router)
