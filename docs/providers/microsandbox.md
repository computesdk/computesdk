---
description: >-
  Microsandbox provider for ComputeSDK with hardware-isolated local and cloud microVM backends.
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

# Microsandbox

Microsandbox runs hardware-isolated Linux microVMs through one SDK. The ComputeSDK provider supports the embedded local runtime and microsandbox cloud without changing the sandbox, command, or filesystem API.

## Installation

Microsandbox requires Node.js 22 or newer.

```bash
npm install computesdk @computesdk/microsandbox
```

## Local backend

Local execution is the default and does not require credentials:

```typescript
import { compute } from 'computesdk';
import { microsandbox } from '@computesdk/microsandbox';

compute.setConfig({
  provider: microsandbox({
    backend: 'local',
    image: 'python:3.12',
    ports: [{ host: 8000, guest: 8000 }],
  }),
});

const sandbox = await compute.sandbox.create();
console.log((await sandbox.runCommand('python --version')).stdout);
await sandbox.destroy();
```

The local runtime requires supported hardware virtualization: Hypervisor.framework on Apple Silicon macOS, KVM on Linux, or Windows Hypervisor Platform.

## Cloud backend

Microsandbox cloud uses the same provider methods but does not require virtualization on the caller's machine:

```typescript
compute.setConfig({
  provider: microsandbox({
    backend: {
      kind: 'cloud',
      apiKey: process.env.MSB_API_KEY!,
    },
    image: 'python:3.12',
  }),
});
```

You can also select a configured microsandbox profile with `backend: { kind: 'cloud', profile: 'production' }`. If `backend` is omitted, the provider follows the SDK's `MSB_BACKEND`, `MSB_PROFILE`, active-profile, and local-default resolution order.

## Commands and files

Both backends support command execution, working directories, environment variables, timeouts, background commands, live stdout and stderr callbacks, and native filesystem access.

```typescript
await sandbox.filesystem.mkdir('/workspace');
await sandbox.filesystem.writeFile('/workspace/app.js', 'console.log("hello")');

const result = await sandbox.runCommand('node app.js', {
  cwd: '/workspace',
  onStdout: (chunk) => process.stdout.write(chunk),
});
```

## Local ports and snapshots

Published ports and disk snapshots are currently local-only capabilities. Port mappings must be declared before sandbox creation:

```typescript
const provider = microsandbox({
  backend: 'local',
  ports: [{ host: 3000, guest: 3000 }],
});

compute.setConfig({ provider });
const sandbox = await compute.sandbox.create();
console.log(await sandbox.getUrl({ port: 3000 }));

const snapshot = await provider.snapshot.create(sandbox.sandboxId, {
  name: 'configured',
});
const restored = await compute.sandbox.create({ snapshotId: snapshot.id });
```

Snapshot creation stops the sandbox, captures its writable root disk, and restarts it. Files on that disk survive, but tmpfs paths such as `/tmp` and running processes are not part of the snapshot. Microsandbox cloud currently returns explicit unsupported errors for `getUrl` and snapshot operations because the cloud backend does not yet publish guest ports or provide disk snapshots.
