---
description: >-
  NeevCloud provider for ComputeSDK - run commands and manage files in secure
  cloud sandboxes with preview URLs.
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

# NeevCloud

[NeevCloud](https://neevcloud.com) provider for ComputeSDK - run commands and manage files in secure cloud sandboxes.

## Installation & Setup

```bash
npm install @computesdk/neevcloud
```

Add your NeevCloud credentials to a `.env` file:

```bash
NEEV_API_KEY=your_neev_api_key
NEEV_ORG_ID=your_neev_org_id
NEEV_PROJECT_ID=your_neev_project_id
```

## Usage

```typescript
import { neevcloud } from '@computesdk/neevcloud';

const compute = neevcloud({
  apiKey: process.env.NEEV_API_KEY,
  orgId: process.env.NEEV_ORG_ID,
  projectId: process.env.NEEV_PROJECT_ID,
});

// Create sandbox
const sandbox = await compute.sandbox.create();

// Run a command
const result = await sandbox.runCommand('echo "Hello from NeevCloud!"');
console.log(result.stdout); // "Hello from NeevCloud!"

// Clean up
await sandbox.destroy();
```

### Configuration Options

```typescript
interface NeevCloudConfig {
  /** NeevCloud API key - if not provided, will use NEEV_API_KEY env var */
  apiKey?: string;
  /** Org the sandboxes belong to - if not provided, will use NEEV_ORG_ID env var */
  orgId?: string;
  /** Project the sandboxes belong to - if not provided, will use NEEV_PROJECT_ID env var */
  projectId?: string;
  /** Request timeout in milliseconds */
  timeout?: number;
}
```

### Preview URLs

Expose any port over a public HTTPS URL:

```typescript
await sandbox.runCommand('python3 -m http.server 3000', { background: true });
const url = await sandbox.getUrl({ port: 3000 });
```

### Boot Source

Start from a catalogue template, a raw OCI image, or the platform default (`templateId` and `image` are mutually exclusive):

```typescript
await compute.sandbox.create({ templateId: 'sb-ubuntu-24-04-minimal' });
await compute.sandbox.create({ image: 'docker.io/library/python:3.12' });
```

### Sandbox Options

Set a name, env vars, size and lifetime at create. `cpu` is cores, `memory` is MB, and `timeout` is the sandbox's lifetime in milliseconds; it is deleted when that elapses.

```typescript
await compute.sandbox.create({
  name: 'build-42',
  envs: { NODE_ENV: 'production' },
  cpu: 2,
  memory: 4096,
  timeout: 30 * 60 * 1000,
});
```

### Snapshots

A snapshot saves a sandbox's memory and filesystem. `snapshot.create` resolves once it can be restored.

```typescript
const snapshot = await compute.snapshot.create(sandbox.sandboxId, { name: 'after-install' });
const copy = await compute.sandbox.create({ snapshotId: snapshot.id });
await compute.snapshot.delete(snapshot.id);
```

### Templates

`template.list()` returns the sandbox template catalogue. The catalogue is managed by NeevCloud, so `template.create` and `template.delete` throw.

### Paths

A relative path is resolved from the workspace root (`/workspace`) and an absolute path is used as is, the same in `filesystem` calls and in `runCommand`.

### Streaming and Timeouts

`onStdout` / `onStderr` stream over the NeevCloud exec API, so no port inside the sandbox has to be reachable. A command that outruns its `timeout` returns exit code `124` with the output produced so far.
