# @computesdk/exe-dev

[exe.dev](https://exe.dev) provider for ComputeSDK - standalone Linux VMs (exe.dev calls them sandboxes) with their own reserved vCPU and memory, driven through the exe.dev HTTPS API.

## Installation

```bash
npm install @computesdk/exe-dev
```

## Setup

1. Create an exe.dev account and an API token:

```bash
ssh exe.dev ssh-key generate-api-key --exp=30d
```

2. Set the environment variable:

```bash
export EXE_API_KEY=exe1.your_token
```

Standalone VMs are metered by the second. On Work and Enterprise teams, an admin must allow members to create them (`team settings standalone all-users`). See [Standalone VMs](https://exe.dev/docs/standalone-vms).

## Quick Start

```typescript
import { compute } from 'computesdk';
import { exeDev } from '@computesdk/exe-dev';

compute.setConfig({
  provider: exeDev({ apiKey: process.env.EXE_API_KEY }),
});

const sandbox = await compute.instances.create();

const result = await sandbox.runCommand('python3 -c "print(2 + 2)"');
console.log(result.stdout); // 4

await sandbox.filesystem.writeFile('/tmp/hello.txt', 'hello');
console.log(await sandbox.filesystem.readFile('/tmp/hello.txt'));

// Private to your exe.dev account unless you run `ssh exe.dev share set-public <vm>`
console.log(await sandbox.getUrl({ port: 3000 })); // https://<vm>.exe.xyz:3000/

await sandbox.destroy();
```

## Configuration

```typescript
exeDev({
  apiKey: 'exe1...',          // or EXE_API_KEY
  apiUrl: 'https://exe.dev/exec', // default
  egress: 'integrations',     // optional: block the public internet for new VMs
});
```

## Create Options

| Option | exe.dev flag | Notes |
| --- | --- | --- |
| `name` | `--name` | Lowercase letters, digits and hyphens. Defaults to `csdk-<random>`. |
| `templateId` | `--image` | Any Docker image, e.g. `ubuntu:24.04`. Defaults to exe.dev's `exeuntu` image. |

Every VM is created with `new --standalone`.

## Features

- Create, get, list and destroy standalone VMs (`new`, `ls`, `rm`)
- Run commands over `ssh <vm>` through `POST https://exe.dev/exec`, with exit codes
- Filesystem through the ComputeSDK shell filesystem (runs over `runCommand`)
- `getUrl` for ports 3000-9999 (`https://<vm>.exe.xyz:<port>/`)

## Limitations

- exe.dev ends each `/exec` request after 30 seconds, so a single command cannot run longer. Use `background: true` for long jobs.
- No stdin, PTY, or streaming output through the HTTPS API.
- `envs`, `timeout`, `sizeClass` and snapshots on create are not supported. VMs live until you destroy them.
- Port URLs need an exe.dev login unless the VM is shared publicly.

## Links

- [exe.dev standalone VMs](https://exe.dev/docs/standalone-vms)
- [exe.dev HTTPS API](https://exe.dev/docs/https-api)
- [HTTP proxy and ports](https://exe.dev/docs/proxy)
