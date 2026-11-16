---
description: >-
  Maritime provider for ComputeSDK - Firecracker microVM sandboxes with streaming
  command output, filesystem access, port URLs and snapshots.
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

# Maritime

[Maritime](https://maritime.sh) provider for ComputeSDK - Firecracker microVM sandboxes with streaming command output, filesystem access, port URLs and snapshots.

## Installation & Setup

```bash
npm install @computesdk/maritime
```

Create an API key (`mk_...`) with the `sandboxes` scope in the Maritime dashboard at [maritime.sh](https://maritime.sh), then add it to a `.env` file:

```bash
MARITIME_API_KEY=mk_your_maritime_api_key
```

## Usage

```typescript
import { compute } from 'computesdk';
import { maritime } from '@computesdk/maritime';

compute.setConfig({
  provider: maritime({ apiKey: process.env.MARITIME_API_KEY }),
});

const sandbox = await compute.instances.create();

const result = await sandbox.runCommand('uname -a && echo "Hello from Maritime!"');
console.log(result.stdout);

await sandbox.destroy();
```

Or call the provider factory directly:

```typescript
import { maritime } from '@computesdk/maritime';

const sdk = maritime({ apiKey: process.env.MARITIME_API_KEY });

const sandbox = await sdk.sandbox.create({ templateId: 'python', timeout: 30 * 60 * 1000 });
await sandbox.filesystem.writeFile('/tmp/hello.py', 'print(6 * 7)');
console.log((await sandbox.runCommand('python3 /tmp/hello.py')).stdout); // "42\n"

// Live output, streamed as the command runs
await sandbox.runCommand('for i in 1 2 3; do echo $i; sleep 1; done', {
  onStdout: (chunk) => process.stdout.write(chunk),
});

// A private URL for a port inside the sandbox
console.log(await sandbox.getUrl({ port: 8000 }));

// Save the disk and memory, then start a new sandbox from it
const snapshot = await sdk.snapshot.create(sandbox.sandboxId, { name: 'my-snapshot' });
const copy = await sdk.sandbox.create({ snapshotId: snapshot.id });

await copy.destroy();
await sandbox.destroy();
```

## Configuration

```typescript
interface MaritimeConfig {
  /** Maritime API key - if not provided, will use MARITIME_API_KEY env var */
  apiKey?: string;
  /** API base URL - defaults to MARITIME_API_URL, then https://api.maritime.sh */
  baseUrl?: string;
  /** Default sandbox time limit in milliseconds (60s to 24h) */
  timeout?: number;
}
```

## Create Options

| Option | Maps to | Notes |
|---|---|---|
| `templateId`, `image`, `snapshotId` | `from` | A stock template (`base`, `python`, `code-interpreter`, `desktop-linux`), a saved snapshot name, or an OCI image. Defaults to `base`. |
| `timeout` (ms) | `timeLimitSeconds` | Maritime ends the sandbox when it passes. Rounded up to whole seconds, clamped to 60 s - 24 h. |
| `envs` | `env` | Environment variables for every command. |
| `name` | `name` | Sandbox name. |
| `metadata` | `metadata` | Values are stored as strings. |
| `size`, `vcpu`, `memoryMib`, `diskGib`, `screen`, `network`, `endUser`, `idleTimeoutSeconds`, `onIdle`, `keepAwake`, `failFast` | same | Passed straight to Maritime's create call. |

## Features

- **Command execution** with `cwd`, `env`, `timeout` and background commands. A timed-out command reports exit code 124.
- **Streaming**: foreground commands stream stdout and stderr through `onStdout` / `onStderr`.
- **Filesystem**: read, write, list and remove use Maritime's Files API; mkdir and exists run as shell commands.
- **Port URLs**: `getUrl({ port })` returns a URL that carries the sandbox's URL token.
- **Snapshots**: `snapshot.create` saves the sandbox's disk and memory under a name; pass it as `snapshotId` to start new sandboxes from it. `snapshot.list` and `snapshot.delete` manage saved snapshots.
- **List**: `sandbox.list()` returns sandboxes that have not ended.

## Limitations

- Commands run for at most 1 hour (Maritime's per-command limit). Without `timeout`, the provider asks for that limit instead of Maritime's 60-second default.
- Pause and resume are not exposed through this provider, and templates cannot be created or deleted (Maritime's templates are saved snapshots).
- By default Maritime pauses a sandbox after 5 idle minutes (`onIdle`, `idleTimeoutSeconds`) and ends it at its time limit; call `destroy()` when you are done.

## Links

- [Maritime](https://maritime.sh)
- [Maritime docs](https://maritime.sh/docs)
- [maritime-sdk on npm](https://www.npmjs.com/package/maritime-sdk)
