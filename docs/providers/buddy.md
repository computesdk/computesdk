---
description: >-
  Install and use the Buddy provider for ComputeSDK: Ubuntu sandboxes from a
  pre-warmed pool, public tunnels, native filesystem endpoints and snapshots.
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

# Buddy

Buddy provider for ComputeSDK.

Each sandbox is an Ubuntu microVM in your Buddy project, served from a pre-warmed pool. The provider is built on [`@buddy-works/sandbox-sdk`](https://www.npmjs.com/package/@buddy-works/sandbox-sdk), Buddy's official TypeScript SDK.

## Installation & Setup

```bash
npm install @computesdk/buddy
```

Node 20.19 or newer is required, because the Buddy SDK ships ESM only.

1. Create an API token in **Buddy → My ID → Access tokens** with the `SANDBOX_MANAGE` scope
2. Create (or pick) a Buddy project for your sandboxes
3. Set environment variables:

```bash
export BUDDY_TOKEN=your_api_token_here
export BUDDY_WORKSPACE=your_workspace_domain
export BUDDY_PROJECT=your_project_name
```

## Usage

```typescript
import { compute } from 'computesdk';
import { buddy } from '@computesdk/buddy';

compute.setConfig({ provider: buddy() });

const sandbox = await compute.sandbox.create();

const result = await sandbox.runCommand('echo "hello from buddy"');
console.log(result.stdout);

await sandbox.destroy();
```

Credentials come from the environment, so `buddy()` needs no arguments. Pass them explicitly to override.

### Configuration Options

```typescript
buddy({
  token: process.env.BUDDY_TOKEN,   // API token with the SANDBOX_MANAGE scope
  workspace: 'acme',                // workspace domain
  project: 'sandboxes',             // project the sandboxes belong to
  os: 'ubuntu:24.04',               // or 'ubuntu:22.04'
  resources: '4x8',                 // vCPU x RAM preset, 1x2 through 12x24
  region: 'US',                     // installation: 'US' or 'EU'      
  timeout: 3_600_000,               // sandbox lifetime in ms
  ports: [3000],                    // ports exposed on every sandbox
  apiUrl: undefined,                // overrides region, for on-premise
});
```

### Choosing an installation

Buddy runs independent installations rather than regions within one API, each with its own host, accounts and tokens. `region` selects both the API host and where tunnels terminate.

| `region`       | API host                       |
| -------------- | ------------------------------ |
| `US` (default) | `https://api.buddy.works`      |
| `EU`           | `https://api.eu.buddy.works`   |

A token issued by one installation is not valid on the others.

### Create options

```typescript
await compute.sandbox.create({
  ports: [3000, { port: 443, type: 'TLS' }],
  resources: '4x8',                  // or cpu / memory, which map onto a preset
  firstBootCommands: 'npm ci',       // runs once, when the sandbox first boots
  appDir: '/buddy/app',
  tags: ['ci'],
  snapshotId: 'snapshot-id',         // boot from a snapshot instead of a base image
});
```

## Commands

```typescript
const result = await sandbox.runCommand('npm test', {
  cwd: '/buddy/app',
  env: { CI: '1' },
  onStdout: chunk => process.stdout.write(chunk),
});
```

Output is streamed as the command runs, with stdout and stderr kept apart, and `exitCode` comes from Buddy's own command record. `background: true` returns as soon as the command is queued; `timeout` terminates it.

## Exposing Ports

```typescript
const sandbox = await compute.sandbox.create({ ports: [3000] });
await sandbox.runCommand('npx serve -l 3000', { background: true });

const url = await sandbox.getUrl({ port: 3000 });
```

`getUrl` opens a tunnel on demand if the port has none, keeping tunnels that are already open. Only `HTTP` and `TLS` tunnels get a public URL; `TCP` and `SSH` tunnels are reached by host and port, reported in `getInfo`.

## Filesystem

```typescript
await sandbox.filesystem.mkdir('/buddy/app');
await sandbox.filesystem.writeFile('/buddy/app/index.js', 'console.log(1)');
await sandbox.filesystem.readFile('/buddy/app/index.js');
await sandbox.filesystem.readdir('/buddy/app');
await sandbox.filesystem.exists('/buddy/app/index.js');
await sandbox.filesystem.remove('/buddy/app');
```

Filesystem calls go through Buddy's content endpoints rather than the shell, so content is never squeezed through command-line quoting and each call costs one round trip. As with every provider, `readFile` and `writeFile` handle UTF-8 text; use `getInstance().fs` for raw bytes. Relative paths resolve against `/buddy`, the home directory of the default `buddy` user.

The first filesystem call on a sandbox waits for first-boot setup to finish. Buddy queues *commands* against a starting sandbox, but the content endpoints do not: during setup they either refuse the request or accept a write and discard it. The wait costs a few hundred milliseconds once per sandbox.

## Snapshots

```typescript
const snapshot = await compute.snapshot.create(sandbox.sandboxId, { name: 'with-deps' });

await compute.snapshot.list();
await compute.snapshot.list({ sandboxId: sandbox.sandboxId });
await compute.snapshot.delete(snapshot.id);

const prepared = await compute.sandbox.create({ snapshotId: snapshot.id });
```

Buddy creates snapshots asynchronously and they cannot be restored until they turn `CREATED`, so `create` waits for that. Buddy has no separate template entity, so `compute.template.list` and `compute.template.delete` alias the snapshot methods, and `compute.template.create` throws with a pointer to `compute.snapshot.create`.

## Dropping down to the Buddy SDK

`getInstance()` returns the provider's handle, including the live SDK client and filesystem, so Buddy features outside the ComputeSDK surface stay reachable:

```typescript
const { client, fs, sandboxId } = sandbox.getInstance();
await client.startSandboxApp({ path: { sandbox_id: sandboxId, app_id: 'web' } });
```

## Supported Operations

| Method       | Supported | Notes                                                                                       |
| ------------ | --------- | ------------------------------------------------------------------------------------------- |
| `create`     | ✅         | One request; returns while the sandbox is still starting, since commands queue against it.   |
| `getById`    | ✅         | Returns `null` when the sandbox no longer exists.                                            |
| `list`       | ✅         | Lists the sandboxes in the configured project.                                               |
| `destroy`    | ✅         | Retries on server errors; a no-op if the sandbox is already gone.                            |
| `runCommand` | ✅         | Streams stdout and stderr separately, with real exit codes.                                  |
| `getInfo`    | ✅         | Reports Buddy's status, setup status and every tunnel in `metadata`.                          |
| `getUrl`     | ✅         | Opens a tunnel if the port has none yet, keeping the existing ones.                          |
| `filesystem` | ✅         | Native content endpoints — no shell quoting, one round trip each.                            |
| `snapshot`   | ✅         | `create` / `list` / `delete`; `create` waits until the snapshot is restorable.                |
| `template`   | ⚠️        | No template entity in Buddy — `list`/`delete` alias snapshots, `create` throws with a hint.  |

## Notes

- `create` does not wait for the sandbox to reach `RUNNING`, because Buddy queues commands submitted against a starting sandbox. For the same reason the provider calls the SDK's `BuddyApiClient` directly instead of `Sandbox.create()`, which polls for readiness once a second.
- Sandbox placement inside an installation is not selectable; `region` picks the installation and the tunnel location.
