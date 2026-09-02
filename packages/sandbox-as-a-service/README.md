# @computesdk/sandbox-as-a-service

[Sandbox as a Service](https://sandbox-as-a-service.com) provider for ComputeSDK.

Each sandbox is a **full cloud VM with its own kernel** — not a microVM and not a container. That is
a real trade in both directions:

- **Slower to start.** Roughly 30 seconds, against milliseconds for snapshot-restoring microVM
  runtimes. If your workload creates and destroys a sandbox on every agent turn, this is the wrong
  provider.
- **An ordinary Linux machine in exchange.** Sessions run up to 24 hours on any account with no
  subscription tier, and the guest is not subject to microVM constraints.

## Install

```bash
npm install @computesdk/sandbox-as-a-service
```

## Use

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

`getUrl` returns a public https address for a port inside the sandbox — so an agent can hand a person
a link to the thing it just built.

```typescript
await sandbox.runCommand('sh', ['-c', 'python3 -m http.server 3000 &']);
const url = await sandbox.getUrl({ port: 3000 });
```

The server only needs to listen on `localhost`. **No inbound port is opened on the machine**: the
request is carried in over the control plane's existing connection, so the sandbox's inbound attack
surface stays empty and there is no per-sandbox firewall rule.

## Configuration

| Option | Default | |
|---|---|---|
| `apiKey` | `AAS_API_KEY` | Key from [the dashboard](https://sandbox-as-a-service.com/dashboard/keys). |
| `baseUrl` | `AAS_BASE_URL` | Defaults to the public API. |
| `size` | `small` | `small` 2 vCPU / 4 GB, `medium` 4 / 8, `large` 8 / 16. |
| `timeoutMinutes` | 15 | Up to 1440. The platform destroys the sandbox at expiry regardless. |

## Support matrix

| | |
|---|---|
| Create / get / list / destroy | ✅ |
| `runCommand` | ✅ |
| Filesystem | ✅ — through a dedicated endpoint, so quotes, newlines and binary survive |
| `getUrl` (preview URLs) | ✅ |
| Snapshots / custom images | ❌ |
| GPUs | ❌ |

Billed per second from prepaid credit, from $0.09/hour. New accounts start with free credit and no
card.
