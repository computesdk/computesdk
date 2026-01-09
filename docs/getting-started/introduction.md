# Introduction

## What is ComputeSDK?

ComputeSDK gives you one consistent API to control sandboxes across multiple providers. Spin up isolated environments, execute shell commands, work with filesystems, and more without worrying about vendor-specific APIs. Perfect for building AI agents that execute code, running untrusted code safely, or orchestrating cloud workloads all while remaining provider-agnostic.

## How It Works

ComputeSDK operates on three core concepts:

**Sandboxes** - Isolated compute environments where code executes safely  
**Providers** - Cloud platforms hosting the sandboxes (E2B, Modal, Railway, etc.)  
**Gateway** - ComputeSDK's orchestration layer that unifies provider APIs

When you call `compute.sandbox.create()`, ComputeSDK:
1. Detects your configured provider from environment variables
2. Provisions a new sandbox on that provider
3. Returns a unified interface regardless of underlying provider
4. Handles provider-specific authentication, API quirks, and errors

This means you write code once and can switch providers by changing environment variables - no code changes required.

## Why ComputeSDK?

🔄 **Provider-agnostic** - Switch between Railway, E2B, Vercel, Daytona, Modal and more without code changes  
🛡️ **Security-first** - Isolated sandboxes protect your infrastructure  
⚡ **Developer experience** - Simple, TypeScript-native API  
🌍 **Production-ready** - Used by teams building the next generation of developer tools

### Perfect for building:

- **Code execution platforms** - Run user-submitted code safely
- **Educational tools** - Interactive coding environments
- **Data analysis applications** - Process code with filesystem access
- **AI-powered development tools** - Let AI agents write and execute code
- **Testing & CI/CD systems** - Isolated test environments

## Features

🚀 **Multi-provider support** - Railway, E2B, Vercel, Daytona, Modal and more  
📁 **Filesystem operations** - Read, write, create directories  
⚡ **Command execution** - Run shell commands directly  
🛡️ **Type-safe** - Full TypeScript support with comprehensive error handling  
📦 **Simplicity** - Auto detection of providers and simple setup  

## Quick Example

```bash
npm install computesdk

export COMPUTESDK_API_KEY=your_computesdk_api_key

export PROVIDER_API_KEY=your_provider_api_key
```


```typescript
import { compute } from 'computesdk';

// computeSDK will auto detect the provider

// Create a sandbox
const sandbox = await compute.sandbox.create();

// Execute code
const result = await sandbox.runCode('print("Hello World!")');
console.log(result.output); // "Hello World!"

// Clean up
await compute.sandbox.destroy(sandbox.sandboxId);
```

## Next Steps

Ready to get started? Check out our [installation guide](/docs/getting-started/installation) or dive into the [quick start](/docs/getting-started/quick-start) to begin building with ComputeSDK.