# @computesdk/briq

[Briq](https://briq.cloud) provider for ComputeSDK. Each instance is a sandbox on its own microVM.

## Installation

```bash
npm install @computesdk/briq
```

Needs Node 22.6 or later (the `@briq-cloud/sdk` client requires it).

## Setup

Create an API key on the **Agents** page of the [Briq dashboard](https://app.briq.cloud), then set it:

```bash
BRIQ_API_KEY=your_briq_api_key
```

## Usage

```typescript
import { briq } from '@computesdk/briq';

const compute = briq({ apiKey: process.env.BRIQ_API_KEY });

const sandbox = await compute.instances.create();

const result = await sandbox.runCommand('echo "Hello from Briq!"');
console.log(result.stdout);

await sandbox.filesystem.writeFile('/workspace/hello.txt', 'hi');

// Interactive process
const job = await sandbox.startProcess('cat', { stdin: true });
await job.write('hello\n');
await job.closeStdin();
console.log(await job.wait({ timeout: 5000 }));

await sandbox.destroy();
```

## Configuration

```typescript
interface BriqConfig {
  /** Briq API key. Falls back to the BRIQ_API_KEY environment variable. */
  apiKey?: string;
  /** API address. Falls back to BRIQ_API_URL, then https://api.briq.cloud. */
  baseUrl?: string;
  /** Stack that holds the instances. Default "computesdk". */
  stack?: string;
  /** Custom HTTP transport. It must honor AbortSignal; redirects are refused. */
  fetch?: typeof fetch;
}
```

Without a key, the first call fails with the setup steps.

## Create options

| Option | Notes |
|---|---|
| `name` | Lowercase letters, digits and hyphens, 32 characters at most. |
| `envs` | Stored encrypted by Briq. The API must support literal environment values. |
| `metadata` | A JSON object, 1024 characters serialized. Returned by `getInfo`. |
| `directory` | Absolute path used as the working directory. Default `/workspace`. |
| `signal` | Cancels creation. |

Other options are refused before anything is created: `timeout`, `image`, templates, snapshots,
`resources`, `sizeClass`, `volumes` and `egress`.

## Capabilities

| Capability | Supported | Notes |
|---|---|---|
| `runCommand` | Yes | Output streams live. Default timeout 30 seconds, maximum one hour. Output is limited to 8 MiB. |
| `runCommand` with `background` | Yes | Detached with `nohup`; returns exit code 0 once started. No output, no handle. Use `startProcess` to manage a process. |
| `startProcess` | Yes | stdin, status, wait, kill and callbacks. |
| Filesystem | Yes | UTF-8 text. Listings refuse symbolic links. |
| `getUrl` | Yes | A private HTTP preview. One port per instance: a new port replaces the old one. |
| `list` | Yes | Instances this provider created in the stack. |
| Templates, snapshots, volumes | No | |

## Behavior

- Instances run the Briq sandbox image, Linux amd64, on Briq's `small` size. `resources` and `sizeClass` are refused.
- A command that times out is stopped. It is never run a second time.
- When the outcome of a command is unknown, the call fails instead of returning a guess.
