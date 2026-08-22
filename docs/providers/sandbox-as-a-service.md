---
description: >-
  Sandbox as a Service provisions a full cloud VM per sandbox with 24-hour
  sessions, public preview URLs that open no inbound port, and per-second
  billing.
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

# Sandbox as a Service

[Sandbox as a Service](https://sandbox-as-a-service.com) provider for ComputeSDK.

Each sandbox is a **full cloud VM with its own kernel** — not a microVM and not a container. That is
a real trade in both directions, and it is worth being plain about which way it cuts:

- **Slower to start.** Roughly 30 seconds, against milliseconds for snapshot-restoring microVM
  runtimes. A workload that creates and destroys a sandbox on every agent turn should use something
  else.
- **An ordinary Linux machine in exchange.** Sessions run up to 24 hours on any account with no
  subscription tier, and the guest is not subject to microVM constraints.

## Installation & Setup

```bash
npm install @computesdk/sandbox-as-a-service
```

Get an API key at [sandbox-as-a-service.com](https://sandbox-as-a-service.com) — new accounts start
with free credit and no card.

```bash
export AAS_API_KEY=aas_sk_...
```

## Usage

```typescript
import { compute } from 'computesdk';
import { sandboxAsAService } from '@computesdk/sandbox-as-a-service';

compute.setConfig({
  defaultProvider: sandboxAsAService({ apiKey: process.env.AAS_API_KEY }),
});

const sandbox = await compute.sandbox.create();

const result = await sandbox.runCommand('python3', ['-c', 'print(6 * 7)']);
console.log(result.stdout); // 42

await sandbox.destroy();
```

## Preview URLs

`getUrl` returns a public https address for a port inside the sandbox, so an agent can hand a person
a link to what it just built.

```typescript
await sandbox.runCommand('sh', ['-c', 'python3 -m http.server 3000 &']);
const url = await sandbox.getUrl({ port: 3000 });
```

The server only needs to listen on `localhost`. **No inbound port is opened on the machine** — the
request is carried in over the control plane's existing connection, so the sandbox's inbound attack
surface stays empty and there is no per-sandbox firewall rule to manage. WebSocket upgrades pass
through, so a dev server with live reload works normally.

## Filesystem

File operations go through a dedicated endpoint rather than through the shell, so quotes, newlines
and binary content survive without escaping.

```typescript
await sandbox.filesystem.writeFile('/workspace/app.py', "print('hello')");
const source = await sandbox.filesystem.readFile('/workspace/app.py');
const entries = await sandbox.filesystem.readdir('/workspace');
```

## Configuration

| Option | Environment | Default | |
|---|---|---|---|
| `apiKey` | `AAS_API_KEY` | — | Required. From the dashboard. |
| `baseUrl` | `AAS_BASE_URL` | `https://sandbox-as-a-service.com/v1` | |
| `size` | — | `small` | `small` 2 vCPU / 4 GB, `medium` 4 / 8, `large` 8 / 16. |
| `timeoutMinutes` | — | 15 | Up to 1440. The platform destroys the sandbox at expiry regardless. |

## Support matrix

| | |
|---|---|
| Create / get / list / destroy | ✅ |
| `runCommand` | ✅ |
| Filesystem | ✅ |
| `getUrl` (preview URLs) | ✅ |
| Snapshots, custom images, templates | ❌ |
| GPUs | ❌ |

## Pricing

Per second from prepaid credit, from $0.09/hour for 2 vCPU / 4 GB / 40 GB. No subscription and no
seats.
