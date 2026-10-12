# @computesdk/sandbox-cli

[sandbox-cli](https://github.com/Amitgb14/sandbox-cli) provider for ComputeSDK.

sandbox-cli runs every sandbox as a microVM with its own kernel, behind one HTTP
API that is the same in three places: on a Mac (the native macOS `container`
runtime), on a Linux machine you control (Firecracker under KVM), and in the
cloud. This provider talks to that API with `fetch`; it has no other
dependency.

## Installation

```bash
npm install @computesdk/sandbox-cli
```

## Setup

Point the provider at a `sandboxd` (one machine) or a `sandbox-gateway` (many
machines) and give it a token:

```bash
export SANDBOX_ENDPOINT=https://sandbox.example.com
export SANDBOX_TOKEN=your_token
# on a gateway, optionally the organization to act in
export SANDBOX_ORG=your_org
```

These are the same variables the `sandbox-cli` command and its SDKs read.

## Usage

```typescript
import { sandboxCli } from '@computesdk/sandbox-cli';

const compute = sandboxCli({
  endpoint: process.env.SANDBOX_ENDPOINT,
  token: process.env.SANDBOX_TOKEN,
});

// Create a sandbox: resolves once the VM is booted and running
const sandbox = await compute.sandbox.create();

// Run a command
const result = await sandbox.runCommand('node -v');
console.log(result.stdout);

// Live output
await sandbox.runCommand('for i in 1 2 3; do echo $i; sleep 1; done', {
  onStdout: (chunk) => process.stdout.write(chunk),
});

// Files
await sandbox.filesystem.writeFile('/sandbox/home/hello.txt', 'hi');
console.log(await sandbox.filesystem.readFile('/sandbox/home/hello.txt'));

await sandbox.destroy();
```

## Configuration

```typescript
interface SandboxCliConfig {
  /** API endpoint; falls back to SANDBOX_ENDPOINT */
  endpoint?: string;
  /** Bearer token; falls back to SANDBOX_TOKEN */
  token?: string;
  /** On a gateway, the organization to act in; falls back to SANDBOX_ORG */
  org?: string;
  /** Default sandbox lifetime in milliseconds; unset leaves the server's default */
  timeout?: number;
}
```

### Create options

| ComputeSDK option | sandbox-cli field |
|---|---|
| `image` / `templateId` | `image` (an OCI image) |
| `snapshotId` | `snapshot_id` |
| `name` | `name` |
| `envs` | `env` |
| `metadata` | `labels` (values as strings) |
| `cpus` / `vcpus` / `cpu` | `cpus` |
| `memoryMb` / `memory` / `memoryMiB` / `memMiB` | `memory_mb` |
| `diskMb` / `diskMiB` | `disk_mb` |
| `timeout` (ms) | `lifetime_secs` |

The server's policy has the last word: a request may tighten what is in force,
never loosen it, and one it cannot honour is refused rather than weakened.

## Supported

- Sandbox lifecycle: `create`, `getById`, `list`, `destroy`
- `runCommand`, with `cwd`, `env`, `timeout` and `background`
- Live output (`onStdout` / `onStderr`) through the API's own process stream
- Filesystem: `readFile`, `writeFile`, `mkdir`, `readdir`, `exists`, `remove`
- `getInfo`

## Limitations

- `getUrl` is not supported. A port inside a sandbox is reached through the
  API's tunnel (an upgraded connection to the guest's own loopback), not a
  public URL; use `sandbox-cli tunnel`.
- Commands run through `sh -c` as the sandbox user, starting in
  `/sandbox/home`.
