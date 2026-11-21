---
description: >-
  Uno provider for ComputeSDK - full Linux Firecracker microVMs with systemd,
  apt and sudo for AI agents and builds, with a US High-end region.
layout:
  width: default
  title:
    visible: true
  description:
    visible: false
  tableOfContents:
    visible: true
  outline:
    visible: true
  pagination:
    visible: true
  metadata:
    visible: true
  tags:
    visible: true
  actions:
    visible: true
---

# Uno

[Uno](https://uno.place) provider for ComputeSDK - full Linux microVMs (Firecracker) for AI agents and builds.

Every Uno machine is a full Linux microVM on Firecracker, not a container: systemd, `apt`, passwordless `sudo` and a real disk. It boots from a warm snapshot in seconds. Machines in the **US region run on High-end servers**, on our fastest processors.

## Installation

```bash
npm install @computesdk/uno
```

The behavior documented below applies to the published `@computesdk/uno@0.1.7`.
The adapter changes merged in [#1176](https://github.com/computesdk/computesdk/pull/1176)
are pending an npm release and are not included in that version.

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

## Standard sizes

`create({ sizeClass })` sends the exact standard profile as `vcpu` / `ram_mb` (and, for `sm`–`xl`, `disk_gb`) to `POST /api/v1/boxes`:

| `sizeClass` | vCPU | Memory (MiB) | Disk |
| --- | ---: | ---: | --- |
| `xs` | 1 | 1024 | config `diskGb` (default 10 GB) |
| `sm` | 1 | 2048 | 10 GiB |
| `md` | 2 | 4096 | 20 GiB |
| `lg` | 4 | 8192 | 40 GiB |
| `xl` | 8 | 16384 | 80 GiB |
| `2xl` | 16 | 32768 | config `diskGb` (default 10 GB) |
| `3xl` | 32 | 65536 | config `diskGb` (default 10 GB) |

- Your plan limits one machine: Small 1 vCPU / 1 GiB, Plus 4 / 4 GiB, Pro 16 / 16 GiB, Max 32 / 48 GiB (`max_box` in `GET /api/v1/box-plans`). `3xl` needs Enterprise capacity. A size over your plan fails at create with Uno's 409 (`PEAK_EXCEEDED`, `SHAPE_TOO_LARGE`, …); it never boots a smaller machine.
- `sizeClass` cannot be combined with `vcpus`/`cpus`/`cpu`, `memoryMiB`/`memMiB`/`memoryMb`/`memory`, `vcpu`, `ram_mb`/`ramMb` or `disk_gb`/`diskGb`, nor with `diskMiB`/`diskMb` on `sm`–`xl`: that is an `InstanceSizeError` with code `conflict`.
- `sizeClass` with `snapshotId` is `unsupported`: a machine made from a snapshot keeps the source's vCPU, memory and disk.
- `templateId` (the OS template) works with every size.

## How commands run

- Commands run as user `uno` in a login `bash` shell, in the home directory. Use `sudo` for root.
- A command can run for up to 1 hour (`timeout`, default 5 minutes). Long commands are long-polled, so no single HTTP response hangs on proxy time limits. Retries use an idempotency key, so a dropped connection never starts a command twice.
- Up to 256 KiB of stdout and 64 KiB of stderr are returned per command; if either was cut, `stderr` ends with an `[uno] … truncated` line. Command text is limited to 64 KiB: write bigger inputs with `filesystem.writeFile` first.
- `filesystem.readFile`, `writeFile` and `readdir` have no size limit: they move data in chunks, and `writeFile` renames a temp file into place only after every chunk landed.
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
