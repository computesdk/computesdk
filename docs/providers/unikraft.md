---
description: >-
  Unikraft Cloud provider for ComputeSDK - microVM sandboxes that boot from a
  container image in milliseconds, with filesystem access and instance templates.
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

# Unikraft Cloud

[Unikraft Cloud](https://unikraft.cloud) provider for ComputeSDK - microVM sandboxes that boot from a container image in milliseconds, with filesystem access and instance templates.

## Installation & Setup

```bash
npm install @computesdk/unikraft
```

Add your Unikraft Cloud token to a `.env` file:

```bash
UKC_TOKEN=your_unikraft_cloud_token
UKC_METRO=fra
```

Get your token at [console.unikraft.cloud](https://console.unikraft.cloud). `UKC_METRO` is optional. It names the metro, which is the data center that runs your sandboxes.

## Usage

```typescript
import { unikraft } from '@computesdk/unikraft';

const compute = unikraft({
  token: process.env.UKC_TOKEN,
  metro: 'fra',
});

// Create a sandbox from the default image
const sandbox = await compute.instances.create();

// Or name an image, the memory, and the vCPUs
const sandbox2 = await compute.instances.create({
  image: 'my-org/sandbox-base:latest',
  memoryMb: 1024,
  vcpus: 2,
});

// Or clone an instance template
const sandbox3 = await compute.instances.create({ snapshotId: 'my-template' });

// Run a command
const result = await sandbox.runCommand('echo "Hello from Unikraft Cloud!"');
console.log(result.stdout); // "Hello from Unikraft Cloud!"

// Work with files
await sandbox.filesystem.writeFile('/tmp/hello.py', 'print("Hello World")');
const content = await sandbox.filesystem.readFile('/tmp/hello.py');

// Clean up
await sandbox.destroy();
```

### Configuration Options

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

### Concepts

- **Metro.** A metro is one Unikraft Cloud data center, for example `fra` or `was`. A sandbox lives in one metro, and its ID resolves in no other.
- **Image.** A sandbox boots from a container image. The default is `debian-slim:latest`. Push your own image to the Unikraft Cloud registry and name it as `my-org/name:tag`.
- **Template.** An instance template is a saved sandbox. `snapshotId` clones one by UUID or by name. The clone takes the image, the size, and the plugin of the template, so do not pass `image`, `memoryMb`, or `vcpus` with it.

### Limitations

- The sandbox plugin runs each command as `root` with an empty environment. The provider adds `HOME=/root` and the `envs` of the create call to every command.
- A command that runs past its `timeout` returns exit code 124. The provider then stops it with `SIGKILL`.
- `getUrl` needs a sandbox that was created with a `service_group` that publishes the port. Without one, it throws.
- Live output callbacks (`onStdout`, `onStderr`) are not supported.
- The writable layer of a sandbox is memory. Files that a command writes count against `memoryMb`.
