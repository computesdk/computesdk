# Introduction

## What is ComputeSDK?

ComputeSDK gives you one consistent API to control sandboxes across multiple providers. Spin up isolated environments, execute shell commands, work with filesystems, and more without worrying about vendor-specific APIs. Perfect for building AI agents that execute code, running untrusted code safely, or orchestrating cloud workloads all while remaining provider-agnostic.

## How It Works

ComputeSDK is built around provider packages. Each provider has its own package under the `@computesdk/` scope that you install directly. You only install the providers you need, keeping your dependencies lean.

**Sandboxes** - Isolated compute environments where code executes safely  
**Providers** - Cloud platforms hosting the sandboxes, each available as a standalone package  

When you install a provider package like `@computesdk/e2b`, you get a factory function that creates a compute instance configured for that provider. Every provider returns the same unified sandbox interface, so your application code stays the same even if you swap providers later.

## Available Providers

| Package | Provider |
|---------|----------|
| `@computesdk/archil` | Archil |
| `@computesdk/blaxel` | Blaxel |
| `@computesdk/cloudflare` | Cloudflare |
| `@computesdk/codesandbox` | CodeSandbox |
| `@computesdk/daytona` | Daytona |
| `@computesdk/declaw` | Declaw |
| `@computesdk/e2b` | E2B |
| `@computesdk/hopx` | HopX |
| `@computesdk/modal` | Modal |
| `@computesdk/namespace` | Namespace |
| `@computesdk/runloop` | Runloop |
| `@computesdk/upstash` | Upstash |
| `@computesdk/vercel` | Vercel |

## Why ComputeSDK?

**Provider-agnostic** - Switch between providers without code changes  
**Pick what you need** - Install only the provider packages your project requires  
**Security-first** - Isolated sandboxes protect your infrastructure  
**Developer experience** - Simple, TypeScript-native API  
**Production-ready** - Used by teams building the next generation of developer tools

### Perfect for building:

- **Code execution platforms** - Run user-submitted code safely
- **Educational tools** - Interactive coding environments
- **Data analysis applications** - Process code with filesystem access
- **AI-powered development tools** - Let AI agents write and execute code
- **Testing & CI/CD systems** - Isolated test environments

## Features

**Multi-provider support** - 10+ providers available as individual packages  
**Filesystem operations** - Read, write, create directories  
**Command execution** - Run shell commands directly  
**Type-safe** - Full TypeScript support with comprehensive error handling

## Quick Example

Install the provider package for the platform you want to use:

```bash
npm install @computesdk/e2b
```

Set the provider's credentials:

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

### Using Multiple Providers

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

The sandbox API is identical across providers, so you can write helper functions that work with any provider's sandboxes interchangeably.

### Multi-Provider in a Single Config

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

- `priority` — always try providers in order; combine with `fallbackOnError: true` to cascade on failure
- `round-robin` — distribute new sandboxes evenly across providers

Operations like `destroy` and snapshots automatically route to the provider that owns each sandbox, so you don't need to track affinity yourself.

## Next Steps

Ready to get started? Check out our [installation guide](/docs/getting-started/installation) or dive into the [quick start](/docs/getting-started/quick-start) to begin building with ComputeSDK.
