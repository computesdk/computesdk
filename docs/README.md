---
description: >-
  ComputeSDK is the open, multi-provider harness that powers ComputeSDK
  Benchmarks and a TypeScript sandbox SDK for secure code execution across
  multiple cloud providers with one unified API.
---

# Introduction

## ComputeSDK: the benchmark harness for sandboxes

ComputeSDK is the open, multi-provider harness behind [ComputeSDK Benchmarks](https://www.computesdk.com/benchmarks). It exposes one provider-agnostic sandbox API so benchmarks can run the same workload on every provider and produce fair, reproducible results. The same API is also available as a TypeScript SDK for building AI agents, code execution platforms, developer tools, testing systems, and any product that needs safe cloud sandboxes.

Because every provider returns the same sandbox interface, your application code stays the same even when you switch providers.

## How the sandbox API works

ComputeSDK is built around provider packages. Each provider ships as its own package under the `@computesdk/` scope. Install only the providers you need.

**Sandboxes** — Isolated compute environments for running code safely\
**Providers** — Cloud platforms that host those sandboxes

When you install a package like `@computesdk/e2b`, you get a factory function for that provider. Every provider returns the same sandbox interface, so you can swap infrastructure without rewriting core logic.

## Supported sandbox providers

Providers are platforms that sandboxes. Each package under `@computesdk/{provider}` exposes the same sandbox interface, so you can swap infrastructure without rewriting application code.

| Package                        | Provider     |
| ------------------------------ | ------------ |
| `@computesdk/archil`           | Archil       |
| `@computesdk/beam`             | Beam         |
| `@computesdk/blaxel`           | Blaxel       |
| `@computesdk/cloud-run`        | Cloud Run    |
| `@computesdk/cloudflare`       | Cloudflare   |
| `@computesdk/codesandbox`      | CodeSandbox  |
| `@computesdk/createos-sandbox` | CreateOS     |
| `@computesdk/daytona`          | Daytona      |
| `@computesdk/declaw`           | Declaw       |
| `@computesdk/e2b`              | E2B          |
| `@computesdk/hopx`             | HopX         |
| `@computesdk/isorun`           | Isorun       |
| `@computesdk/lightning`        | Lightning    |
| `@computesdk/modal`            | Modal        |
| `@computesdk/northflank`       | Northflank   |
| `@computesdk/opencomputer`     | OpenComputer |
| `@computesdk/run-cloud`        | Run Cloud    |
| `@computesdk/runloop`          | Runloop      |
| `@computesdk/sandbox0`         | Sandbox0     |
| `@computesdk/superserve`       | Superserve   |
| `@computesdk/tensorlake`       | Tensorlake   |
| `@computesdk/upstash`          | Upstash      |
| `@computesdk/vercel`           | Vercel       |

## Why teams use ComputeSDK

**Provider-agnostic sandbox API** — Switch providers with minimal code changes\
**Open benchmark harness** — Powers [ComputeSDK Benchmarks](https://www.computesdk.com/benchmarks) with the same API on every provider\
**Secure code execution** — Run untrusted code in isolated sandboxes\
**Lean installs** — Add only the cloud sandbox providers you need\
**TypeScript-native SDK** — Get a clean developer experience with strong typing\
**Production-ready** — Build reliable AI and developer workflows on one interface

### Common use cases

* **Benchmarking infrastructure providers** — Compare sandbox, storage, browser, and AI gateway providers with one consistent harness
* **AI agent infrastructure** — Let agents run code, commands, and file operations safely
* **Code execution platforms** — Execute user-submitted code in isolated sandboxes
* **Browser IDEs and education tools** — Provide interactive coding environments
* **Data workflows** — Run scripts with filesystem access in disposable environments
* **Testing and CI systems** — Create clean sandboxes for repeatable execution

## Core features

**Open benchmark harness** — Run the same workload on every provider and publish reproducible benchmarks ([ComputeSDK Benchmarks](https://www.computesdk.com/benchmarks))\
**Multi-provider support** — Use E2B, Modal, Vercel, and other providers through one SDK\
**Sandbox lifecycle management** — Create, reconnect, list, and destroy sandboxes\
**Filesystem operations** — Read, write, remove, and organize files\
**Shell command execution** — Run commands directly inside each sandbox\
**Type-safe APIs** — Use full TypeScript support with clear errors

## Quick example

Install a provider package:

```bash
npm install @computesdk/e2b
```

Set your provider credentials:

```bash
export E2B_API_KEY=your_e2b_api_key
```

Create a sandbox and run a command:

```typescript
import { e2b } from '@computesdk/e2b';

// Create a compute instance for E2B
const compute = e2b({ apiKey: process.env.E2B_API_KEY });

// Create a sandbox
const sandbox = await compute.sandbox.create();

// Run a command
const result = await sandbox.runCommand('echo "Hello World!"');
console.log(result.stdout); // "Hello World!"

// Clean up
await sandbox.destroy();
```

This pattern gives you a secure code execution sandbox with a single provider package. The same API shape works across supported providers.

### Use multiple providers

You can use multiple providers in the same project. Install the packages you need and create separate compute instances:

```bash
npm install @computesdk/e2b @computesdk/modal
```

```typescript
import { e2b } from '@computesdk/e2b';
import { modal } from '@computesdk/modal';

// Create compute instances for each provider
const e2bCompute = e2b({ apiKey: process.env.E2B_API_KEY });
const modalCompute = modal({
  tokenId: process.env.MODAL_TOKEN_ID,
  tokenSecret: process.env.MODAL_TOKEN_SECRET,
});

// Use one provider for lightweight tasks
const lightSandbox = await e2bCompute.sandbox.create();
await lightSandbox.runCommand('echo "Quick task"');
await lightSandbox.destroy();

// Use another provider for GPU-intensive workloads
const gpuSandbox = await modalCompute.sandbox.create();
await gpuSandbox.runCommand('python -c "import torch; print(torch.cuda.is_available())"');
await gpuSandbox.destroy();
```

The sandbox API stays consistent across providers. That makes it easier to route workloads by cost, region, latency, or hardware needs.

### Configure multi-provider routing in one SDK

If you'd rather configure several providers together — for resilience, routing, or load balancing — install the `computesdk` core package alongside the providers you want:

```bash
npm install computesdk @computesdk/e2b @computesdk/modal
```

Register multiple providers with `compute.setConfig` and choose a strategy:

```typescript
import { compute } from 'computesdk';
import { e2b } from '@computesdk/e2b';
import { modal } from '@computesdk/modal';

compute.setConfig({
  providers: [
    e2b({ apiKey: process.env.E2B_API_KEY }),
    modal({
      tokenId: process.env.MODAL_TOKEN_ID,
      tokenSecret: process.env.MODAL_TOKEN_SECRET,
    }),
  ],
  providerStrategy: 'priority', // 'priority' (default) or 'round-robin'
  fallbackOnError: true,        // try the next provider if one fails
});

// Uses the configured strategy
const sandbox = await compute.sandbox.create();

// Override per call to target a specific provider by name
const gpuSandbox = await compute.sandbox.create({ provider: 'modal' });
```

**Strategies**

* `priority` — always try providers in order; combine with `fallbackOnError: true` to cascade on failure
* `round-robin` — distribute new sandboxes evenly across providers

Operations like `destroy` and snapshots automatically route to the provider that owns each sandbox, so you don't need to track affinity yourself.

## Next steps

Start with [Installation](getting-started/installation.md) to set up a provider. Then follow [Quick Start](getting-started/quick-start.md) to launch your first sandbox.
