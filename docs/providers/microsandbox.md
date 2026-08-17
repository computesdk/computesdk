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

## Cloud backend

Cloud is the default backend and does not require virtualization on the caller's machine. Pass an API key directly or let the microsandbox SDK resolve `MSB_API_KEY`, `MSB_PROFILE`, or the active profile:

```typescript
import { compute } from 'computesdk';
import { microsandbox } from '@computesdk/microsandbox';

compute.setConfig({
  provider: microsandbox({
    apiKey: process.env.MSB_API_KEY,
    image: 'python:3.12',
  }),
});

const sandbox = await compute.sandbox.create();
console.log((await sandbox.runCommand('python --version')).stdout);
await sandbox.destroy();
```

You can also select a configured cloud profile with `microsandbox({ profile: 'production' })`. Calling `microsandbox()` with no configuration uses the SDK's cloud credential and profile resolution. If none resolves, the provider reports how to configure cloud or select local mode instead of silently running locally.

## Local backend

Select local execution explicitly when the sandbox should run on the calling machine. It does not require credentials:

```typescript
compute.setConfig({
  provider: microsandbox({
    backend: 'local',
    image: 'python:3.12',
    ports: [{ host: 8000, guest: 8000 }],
  }),
});
```

The local runtime requires supported hardware virtualization: Hypervisor.framework on Apple Silicon macOS, KVM on Linux, or Windows Hypervisor Platform.

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
