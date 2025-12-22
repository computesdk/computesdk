# Introduction

## What is ComputeSDK?

ComputeSDK is an open-source toolkit for running other people's code in your applications. Think of it as the "AI SDK for compute" - providing a consistent TypeScript interface whether you're using E2B, Vercel, Daytona, Modal, CodeSandbox, or Blaxel.

## Why ComputeSDK?

🔄 **Provider-agnostic** - Switch between E2B, Vercel, Daytona, Modal, CodeSandbox, Blaxel, and more without code changes  
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

🚀 **Multi-provider support** - E2B, Vercel, Daytona, Modal, CodeSandbox, Blaxel, and more  
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
console.log(result.stdout); // "Hello World!"

// Clean up
await compute.sandbox.destroy(sandbox.sandboxId);
```

## Next Steps

Ready to get started? Check out our [installation guide](/docs/getting-started/installation) or dive into the [quick start](/docs/getting-started/quick-start) to begin building with ComputeSDK.