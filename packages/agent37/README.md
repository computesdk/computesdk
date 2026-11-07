# @computesdk/agent37

Agent37 provider for ComputeSDK - persistent Linux sandboxes for AI agents, with signed URLs for any port and an optional Performance type whose cores are held for it.

## Installation

```bash
npm install @computesdk/agent37
```

## Setup

1. Create an API key at [agent37.com/dashboard/cloud/api-keys](https://www.agent37.com/dashboard/cloud/api-keys)
2. Set the environment variable:

```bash
export AGENT37_API_KEY=sk_live_your_api_key
```

## Quick Start

```typescript
import { compute } from 'computesdk';
import { agent37 } from '@computesdk/agent37';

compute.setConfig({
  provider: agent37({ apiKey: process.env.AGENT37_API_KEY }),
});

const sandbox = await compute.instances.create();

const result = await sandbox.runCommand('node -v && python3 --version');
console.log(result.stdout);

await sandbox.destroy();
```

Or call the provider factory directly:

```typescript
import { agent37 } from '@computesdk/agent37';

const sdk = agent37({ apiKey: process.env.AGENT37_API_KEY });
const sandbox = await sdk.sandbox.create({ type: 'performance', cpu: 4, memory: 16384 });
```

## Configuration

```typescript
interface Agent37Config {
  /** Agent37 API key - if not provided, will use AGENT37_API_KEY env var */
  apiKey?: string;
  /** API base URL - defaults to AGENT37_BASE_URL, then https://api.agent37.com */
  baseUrl?: string;
  /** Exec base URL - defaults to AGENT37_EXEC_URL, then https://sandbox.agent37.app */
  execUrl?: string;
  /** Run commands as root (default true). Set false to run as the image's own user. */
  runAsRoot?: boolean;
}
```

## Create Options

| Option | Maps to | Notes |
|---|---|---|
| `templateId` | `template` | Template name. Default `agent37-base` (Debian with Node, Python, git and build tools). |
| `type` | `type` | `default`, `performance` (a whole machine whose cores are held for it) or `vm`. |
| `cpu` (or `vcpus`, `cpus`) | `resources.cpu` | vCPUs. Sizes are 2 vCPU / 4 GB, 4 / 8, 4 / 16 and 4 / 32. |
| `memory` (MB, or `memoryMiB`, `memoryMb`) | `resources.memory` | Rounded up to whole GB. |
| `sizeClass` | `resources` | Standard sizes: `md` (2 vCPU / 4 GB) and `lg` (4 / 8). `xs`, `sm`, `xl` and `2xl` fail with `unsupported`; combining `sizeClass` with `cpu`/`memory` is a `conflict`. |
| `diskMb` (or `diskMiB`) | `resources.disk` | Rounded up to whole GB. |
| `region` | `region` | `us` (default), `eu` or `ap-south`. |
| `envs` | `env` | Environment variables for the sandbox. |
| `name`, `metadata` | `name`, `metadata` | Labels returned on the instance. |

## Features

- **Command execution** with `cwd`, `env` and background commands
- **Filesystem** read, write, list, mkdir, exists and remove
- **Port URLs**: `getUrl({ port })` returns a signed URL that reaches the port without an API key for one hour
- **Persistence**: a sandbox keeps its files and installed packages until you destroy it

## Limitations

- Output is returned when the command finishes; there is no streaming.
- `runCommand`'s `timeout` stops waiting for the result. The command itself keeps running in the sandbox.
- Filesystem content is UTF-8 text, not arbitrary binary. Writes send sequential 90 KiB byte chunks (120 KiB of base64, with about 5 KB left for the command and JSON below the 128 KB request cap) into a unique mode-0600 staging file in the remote shell's writable `TMPDIR` (default `/tmp`), then overwrite in place. Large transfers still make many round trips; there is no fixed-size completion-time guarantee. The base template has no native file HTTP API; the documented SCP alternative requires separately registered workspace SSH keys, which this adapter does not manage. Staging does not require destination-directory write permission. Existing permissions and hard links are preserved, and symlinks are followed. When `flock` is available (as in the base template), an inode lock prevents concurrent SDK writes to the same inode from interleaving; lock errors are propagated. Custom images without `flock` fall back to ordinary redirection, so concurrent writes to the same inode can interleave. Readers can observe the final copy in progress in either case. Failed uploads leave the destination unchanged; a failure during final publication can leave an empty or partial file.
- Reads use GNU `stat`, `dd` and `base64` to transfer at most 256 KiB per exec, below the 512 KB output cap, then decode UTF-8 across chunk boundaries. Empty files and symlink targets are supported. Truncation, malformed chunks, read errors, short reads and detected file changes throw instead of returning partial content. Reads are not snapshots: avoid modifying the file during a transfer. The complete string is still held in client memory.
- Sandboxes have no lifetime limit, so always call `destroy()` when you are done.

## Links

- [Agent37 API docs](https://www.agent37.com/docs)
- [Pricing](https://www.agent37.com/pricing)
