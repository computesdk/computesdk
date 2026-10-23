# @computesdk/unikraft

Unikraft Cloud provider for ComputeSDK. Each sandbox is a microVM on [Unikraft Cloud](https://unikraft.cloud) with the sandbox plugin attached. A sandbox boots from a container image in milliseconds.

## Installation

```bash
npm install @computesdk/unikraft
```

## Setup

1. Create an account at [console.unikraft.cloud](https://console.unikraft.cloud) and copy an API token.
2. Set the environment variables:

```bash
export UKC_TOKEN=your_unikraft_cloud_token
export UKC_METRO=fra
```

`UKC_METRO` is optional. It names the metro, which is the data center that runs your sandboxes. Without it, the provider uses the default metro of the Unikraft Cloud SDK.

## Quick start

Configure `compute` with the Unikraft Cloud provider and create a sandbox:

```typescript
import { compute } from 'computesdk';
import { unikraft } from '@computesdk/unikraft';

compute.setConfig({
  provider: unikraft({ token: process.env.UKC_TOKEN }),
});

const sandbox = await compute.instances.create();

const result = await sandbox.runCommand('echo "Hello from Unikraft Cloud"');
console.log(result.stdout);

await sandbox.destroy();
```

You can also call the provider directly when you need only one provider:

```typescript
import { unikraft } from '@computesdk/unikraft';

const sdk = unikraft({ token: process.env.UKC_TOKEN, metro: 'fra' });
const sandbox = await sdk.instances.create({ image: 'my-org/sandbox-base:latest' });
```

## Configuration

### Environment variables

| Variable | Meaning |
|---|---|
| `UKC_TOKEN` | API token. Required unless you pass `token`. |
| `UKC_METRO` | Metro code, for example `fra`, or the full API URL of a deployment. |
| `UKC_SANDBOX_IMAGE` | Image for a sandbox whose create call names none. |
| `UKC_SANDBOX_ROM` | Sandbox plugin ROM, for example `plugins/sandbox:1.2.0`. The default is `plugins/sandbox:latest`, the default of the Unikraft Cloud SDK. |

### Configuration options

```typescript
interface UnikraftConfig {
  /** API token. If absent, the provider reads `UKC_TOKEN`. */
  token?: string;
  /** Metro code, for example `fra`, or the full API URL of a deployment. If absent, the provider reads `UKC_METRO`. */
  metro?: string;
  /** Image for a sandbox whose create call names none. If absent, the provider reads `UKC_SANDBOX_IMAGE`. */
  image?: string;
  /** Sandbox plugin ROM. If absent, the provider reads `UKC_SANDBOX_ROM`. */
  rom?: string;
  /** Memory for each sandbox, in MiB, if the create call names none. */
  memoryMb?: number;
  /** vCPUs for each sandbox, if the create call names none. */
  vcpus?: number;
  /** Default `runCommand` timeout, in milliseconds. Without it, a command runs until it exits. */
  timeout?: number;
}
```

### Create options

```typescript
const sandbox = await sdk.instances.create({
  image: 'my-org/sandbox-base:latest', // The default is `debian-slim:latest`.
  memoryMb: 1024,
  vcpus: 2,
  envs: { NODE_ENV: 'production' },
  name: 'build-42',
});

// Clone an instance template instead of booting an image.
const clone = await sdk.instances.create({ snapshotId: 'my-template' });
```

`snapshotId` names an instance template by UUID or by name. The clone takes the image, the size, and the plugin of the template, so do not pass `image`, `memoryMb`, or `vcpus` with it.

## Features

- Command execution with `cwd`, `env`, `timeout`, and `background`
- Filesystem access: `readFile`, `writeFile`, and `mkdir` use the file API of the sandbox plugin; `readdir`, `exists`, and `remove` run shell commands
- Instance templates through `snapshotId`
- `getInstance()` returns the `Sandbox` object of `@unikraft/cloud`, which gives you the full platform API

## Limitations

- The sandbox plugin runs each command as `root` with an empty environment. The provider adds `HOME=/root` and the `envs` of the create call to every command.
- A command that runs past its `timeout` returns exit code 124. The provider then stops it with `SIGKILL`.
- `getUrl` needs a sandbox that was created with a `service_group` that publishes the port. Without one, it throws.
- Live output callbacks (`onStdout`, `onStderr`) are not supported.
- The writable layer of a sandbox is memory. Files that a command writes count against `memoryMb`.

## Links

- [Unikraft Cloud documentation](https://unikraft.com/docs)
- [ComputeSDK documentation](https://www.computesdk.com)
