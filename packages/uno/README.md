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
- Up to 256 KiB of stdout and 64 KiB of stderr are returned per command. Command text is limited to 64 KiB: write bigger inputs with `filesystem.writeFile` first.
- One command runs on a machine at a time. A concurrent `runCommand` on the same machine is retried for a few seconds, then fails with `BOX_BUSY`: use one machine per parallel job, or `background: true`.

## Supported

| Feature | |
|---|---|
| create / getById / list / destroy | ✅ |
| runCommand (cwd, env, timeout, background) | ✅ |
| filesystem (read, write, mkdir, readdir, exists, remove) | ✅ via shell |
| getUrl | port 80 only, at `https://<name>.uno4.dev` |
| live output streaming, snapshots, templates API | not yet |

## Links

- Uno: https://uno.place
- API reference: `GET https://console.uno4.dev/api/v1/openapi.yaml`
