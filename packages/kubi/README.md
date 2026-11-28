# @computesdk/kubi

[Kubi](https://trykubi.com) provider for ComputeSDK. A Kubi sandbox is a disposable Kubi screen: a Linux desktop
(Debian 13, 4 vCPU, 8 GB of memory, a 50 GB disk) in its own virtual machine, in the EU. Commands, files and ports
work as on any sandbox; the same API key also drives the desktop itself (screenshots, mouse, keyboard, the
accessibility tree, a live view) through [Kubi's own API](https://docs.trykubi.com).

## Installation

```bash
npm install @computesdk/kubi
```

## Setup

Create an API key in the [Kubi console](https://console.trykubi.com) (API keys) with `read`, `exec` and `power`,
and `network` if you call `getUrl`. Disposable screens are paid from the organization's usage credit.

```bash
export KUBI_API_KEY=kubi_...
```

## Usage

```typescript
import { kubi } from '@computesdk/kubi';

const compute = kubi({ apiKey: process.env.KUBI_API_KEY });

// A disposable screen, deleted by Kubi itself 10 minutes after it is created
const sandbox = await compute.instances.create({ timeout: 10 * 60_000, metadata: { project: 'demo' } });

const result = await sandbox.runCommand('uname -a && python3 --version');
console.log(result.stdout);

await sandbox.filesystem.writeFile('/home/user/hello.txt', 'Hello from Kubi');
console.log(await sandbox.filesystem.readFile('/home/user/hello.txt'));

// An HTTPS URL that reaches port 3000 inside the screen (needs `network`)
console.log(await sandbox.getUrl({ port: 3000 }));

await sandbox.destroy();
```

## Configuration

```typescript
interface KubiConfig {
  /** Kubi API key; falls back to KUBI_API_KEY */
  apiKey?: string;
  /** API base URL; falls back to KUBI_API_URL, then https://api.trykubi.com */
  baseUrl?: string;
  /** Sandbox lifetime in ms: Kubi deletes the screen this long after create (60 s to 30 days). Default 5 minutes. */
  timeout?: number;
}
```

## How it maps

| ComputeSDK | Kubi |
| --- | --- |
| `create` | `POST /v1/screens` (disposable, `ends_in_s` from `timeout`), waits until it runs |
| `getById`, `list`, `destroy` | `GET`, `GET /v1/screens?kind=disposable`, `DELETE` |
| `runCommand` | `POST /v1/screens/{id}/exec`, long-polled to its exit, output read by offset |
| `filesystem.readFile`, `writeFile` | Kubi's files API, up to 1 GiB |
| `filesystem.readdir` | `GET /v1/screens/{id}/dir` |
| `mkdir`, `exists`, `remove` | commands |
| `getUrl` | `PUT /v1/screens/{id}/ports/{port}` with `link` access |

`metadata` becomes the screen's labels. `envs` go into a file in the screen that every command sources first;
a command's own `env` wins over them. Commands run as the desktop user `user` (passwordless `sudo`), in
`/home/user` unless `cwd` says otherwise.

## Limits

- One size at launch (4 vCPU, 8 GB, 50 GB), in the EU (France).
- A blank screen runs in about 20 seconds; a full VM with a desktop, not a container.
- Ports: at most 3 open per screen.

## Snapshots, templates, pause and processes

- **Snapshots** are Kubi templates: `snapshot.create(sandboxId)` saves the screen's disk (not its memory); `create({ snapshotId })` starts new screens from it. Saving takes about a minute and a half for a few GB today.
- **Templates:** `template.list` and `template.delete`; a template is saved with `snapshot.create`.
- **Pause and resume** stop and start the screen: the disk survives, running processes do not.
- **Background processes:** `startProcess` runs on ComputeSDK's shell tier over `runCommand`: stdin, kill, parallel starts and reattach.
- **Size:** `sizeClass: 'lg'` (4 vCPU, 8 GiB) is the one size; other sizes are unsupported.
