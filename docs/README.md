---
description: >-
  ComputeSDK is a sandbox router and CI router: one API to create sandboxes on
  any cloud provider, and a CI engine that runs your GitHub Actions workflows
  on whichever providers you choose.
---

# Introduction

## ComputeSDK: one API for every sandbox provider

ComputeSDK routes compute across cloud providers. It does that in two ways:

* **Sandbox router.** Create, use, and destroy sandboxes through one API, and choose which provider each one lands on. Pick a provider per call, set a priority order with fallback, spread load round-robin, or let the hosted platform place sandboxes from your own provider keys or the compute market.
* **CI router.** [Actions](platform/actions.md) runs your existing GitHub Actions workflows inside sandboxes on the providers your organization registers, instead of on fixed hosted runners. Jobs follow your provider order and report where each one ran.

Every provider returns the same sandbox interface, so your code stays the same when you switch providers or add new ones.

## How the sandbox API works

ComputeSDK is built around provider packages. Each provider ships as its own package under the `@computesdk/` scope. Install only the providers you need.

**Sandboxes** — Isolated compute environments for running code safely\
**Providers** — Cloud platforms that host those sandboxes

When you install a package like `@computesdk/e2b`, you get a factory function for that provider. Every provider returns the same sandbox interface, so you can swap infrastructure without rewriting core logic.

## Supported sandbox providers

Providers are platforms that provide sandboxes. Each package under `@computesdk/{provider}` exposes the same sandbox interface, so you can swap infrastructure without rewriting application code.

| Package                        | Provider     |
| ------------------------------ | ------------ |
| `@computesdk/archil`           | Archil       |
| `@computesdk/aws/agentcore`    | AWS Bedrock AgentCore |
| `@computesdk/beam`             | Beam         |
| `@computesdk/blaxel`           | Blaxel       |
| `@computesdk/buddy`            | Buddy        |
| `@computesdk/gcp/cloud-run`    | Cloud Run    |
| `@computesdk/cloudflare`       | Cloudflare   |
| `@computesdk/codesandbox`      | CodeSandbox  |
| `@computesdk/createos-sandbox` | CreateOS     |
| `@computesdk/daytona`          | Daytona      |
| `@computesdk/e2b`              | E2B          |
| `@computesdk/hopx`             | HopX         |
| `@computesdk/isorun`           | Isorun       |
| `@computesdk/lightning`        | Lightning    |
| `@computesdk/modal`            | Modal        |
| `@computesdk/northflank`       | Northflank   |
| `@computesdk/opencomputer`     | OpenComputer |
| `@computesdk/runloop`          | Runloop      |
| `@computesdk/sandbox0`         | Sandbox0     |
| `@computesdk/superserve`       | Superserve   |
| `@computesdk/tensorlake`       | Tensorlake   |
| `@computesdk/upstash`          | Upstash      |
| `@computesdk/vercel`           | Vercel       |

## Why teams use ComputeSDK

**One API, many providers.** Route sandboxes to E2B, Modal, Vercel, Daytona, and dozens more without rewriting code.\
**Fallback and routing built in.** Priority order, round-robin, and fallback on error, configured once.\
**CI on your own compute.** Run GitHub Actions workflows on the sandbox providers you already pay for.\
**Secure code execution.** Run untrusted code in isolated sandboxes.\
**Lean installs.** Add only the provider packages you need.\
**TypeScript-native.** Strong typing and clear errors across every provider.

### Common use cases

* **AI agent infrastructure.** Let agents run code, commands, and file operations safely, on whichever provider fits the task.
* **Provider failover.** Keep working when one sandbox provider is down or out of capacity.
* **Cost and hardware routing.** Send GPU work to one provider and lightweight tasks to another.
* **CI on sandbox providers.** Move GitHub Actions jobs off fixed runners and onto the providers you choose.
* **Code execution platforms.** Execute user-submitted code in isolated sandboxes.
* **Browser IDEs and education tools.** Provide interactive coding environments.

## Core features

**Multi-provider routing.** One SDK across 50+ sandbox providers, with per-call provider selection and configurable strategies.\
**Hosted placement.** The [platform](platform/sandboxes.md) places sandboxes from your provider keys or the compute market, with price limits.\
**Actions CI.** GitHub-compatible workflows that run on your registered providers ([Actions](platform/actions.md)).\
**Sandbox lifecycle management.** Create, reconnect, list, and destroy sandboxes.\
**Filesystem and shell.** Read and write files and run commands inside each sandbox.\
**Type-safe APIs.** Full TypeScript support with clear errors.

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
const sandbox = await compute.instances.create();

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
const sandbox = await compute.instances.create();

// Override per call to target a specific provider by name
const gpuSandbox = await compute.instances.create({ provider: 'modal' });
```

**Strategies**

* `priority` — always try providers in order; combine with `fallbackOnError: true` to cascade on failure
* `round-robin` — distribute new sandboxes evenly across providers

Operations like `destroy` and snapshots automatically route to the provider that owns each sandbox, so you don't need to track affinity yourself.

## Next steps

Start with [Installation](getting-started/installation.md) to set up a provider, then follow [Quick Start](getting-started/quick-start.md) to launch your first sandbox. To route sandboxes or CI through the hosted platform, see the [Platform overview](platform/README.md).
