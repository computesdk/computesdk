---
description: >-
  Sandbox0 provider for ComputeSDK - fast persistent sandboxes with command
  execution and native filesystem access.
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

# Sandbox0

Sandbox0 provides fast persistent cloud sandboxes with shell command execution and native filesystem operations.

## Installation & Setup

```bash
npm install computesdk @computesdk/sandbox0
```

Set a Sandbox0 team API key:

```bash
export SANDBOX0_TOKEN=your_sandbox0_token
```

`SANDBOX0_BASE_URL` is optional and defaults to `https://api.sandbox0.ai`.
For automated team workloads, set it to the team's home-region endpoint so
requests go directly to the regional gateway.

An interactive access token can also be used by setting both
`SANDBOX0_TOKEN` and `SANDBOX0_TEAM_ID`.

## Usage

```typescript
import { compute } from 'computesdk';
import { sandbox0 } from '@computesdk/sandbox0';

compute.setConfig({
  provider: sandbox0({
    token: process.env.SANDBOX0_TOKEN,
    hardTtl: 600,
  }),
});

const sandbox = await compute.sandbox.create({
  templateId: 'default',
  memory: 256,
});

const result = await sandbox.runCommand('node --version');
console.log(result.stdout);

await sandbox.filesystem.writeFile('/tmp/result.txt', result.stdout);
console.log(await sandbox.filesystem.readFile('/tmp/result.txt'));

await sandbox.destroy();
```

## Configuration Options

```typescript
interface Sandbox0Config {
  token?: string;
  teamId?: string;
  baseUrl?: string;
  templateId?: string;
  ttl?: number;
  hardTtl?: number;
  memory?: number | string;
  envs?: Record<string, string>;
  commandTimeout?: number;
}
```

Numeric memory values are interpreted as MiB. `ttl` and `hardTtl` use seconds; `commandTimeout` uses milliseconds.

Per-create `templateId`, `snapshotId`, `memory`, `envs`, `ttl`, `hardTtl`, and `autoResume` options override provider defaults where applicable.

## Supported Operations

| Method | Supported | Notes |
|---|---|---|
| `create` | ✅ | Claims a Sandbox0 sandbox from a template; supports snapshot restore and memory overrides. |
| `getById` | ✅ | Returns `null` for a missing sandbox. |
| `list` | ✅ | Paginates through sandboxes visible to the team token. |
| `destroy` | ✅ | Idempotent, with bounded retry for throttling and server failures. |
| `runCommand` | ✅ | Uses `sh -lc`; supports `cwd`, env, timeout, and background mode. |
| `getInfo` | ✅ | Uses lifecycle metadata already returned by Sandbox0 without adding a post-create request. |
| `getUrl` | ✅ | Returns the URL of an existing public Sandbox0 service for the requested port. |
| `filesystem` | ✅ | Native read, write, mkdir, list, stat, and delete operations. |

For automated workloads, set `hardTtl` as a safety net in addition to calling `destroy`.

Use `sandbox.getInstance()` for Sandbox0-specific pause/resume, services, snapshots, volumes, and observability APIs.
