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
| `@computesdk/blaxel` | Blaxel |
| `@computesdk/cloudflare` | Cloudflare |
| `@computesdk/codesandbox` | CodeSandbox |
| `@computesdk/daytona` | Daytona |
| `@computesdk/e2b` | E2B |
| `@computesdk/hopx` | HopX |
| `@computesdk/modal` | Modal |
| `@computesdk/namespace` | Namespace |
| `@computesdk/runloop` | Runloop |
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
**Overlays** - Bootstrap sandboxes from templates instantly  
**Managed servers** - Run dev servers with health checks and auto-restart  
**Client-side access** - Delegate sandbox access to browser clients securely

## Quick Example

Install the provider package for the platform you want to use:

```bash
npm install @computesdk/e2b
```

Set the provider's credentials:

```bash
export E2B_API_KEY=your_e2b_api_key
```

Create a sandbox and run code:

```typescript
import { e2b } from '@computesdk/e2b';

// Create a compute instance for E2B
const compute = e2b({ apiKey: process.env.E2B_API_KEY });

// Create a sandbox
const sandbox = await compute.sandbox.create();

// Execute code
const result = await sandbox.runCode('print("Hello World!")');
console.log(result.output); // "Hello World!"

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

// Use one provider for lightweight code execution
const lightSandbox = await e2bCompute.sandbox.create();
await lightSandbox.runCode('print("Quick task")');
await lightSandbox.destroy();

// Use another provider for GPU-intensive workloads
const gpuSandbox = await modalCompute.sandbox.create();
await gpuSandbox.runCode('import torch; print(torch.cuda.is_available())');
await gpuSandbox.destroy();
```

The sandbox API is identical across providers, so you can write helper functions that work with any provider's sandboxes interchangeably.

## Next Steps

Ready to get started? Check out our [installation guide](/docs/getting-started/installation) or dive into the [quick start](/docs/getting-started/quick-start) to begin building with ComputeSDK.
