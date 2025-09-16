# Introduction

## What is ComputeSDK?

ComputeSDK is a free and open-source toolkit for running other people's code in your applications. Think of it as the "AI SDK for compute" - providing a consistent TypeScript interface whether you're using E2B, Vercel, Daytona, Modal, CodeSandbox, or Blaxel.

## Why ComputeSDK?

🔄 **Provider-agnostic** - Switch between E2B, Vercel, Daytona, Modal, CodeSandbox, Blaxel, and more without code changes  
🛡️ **Security-first** - Isolated sandboxes protect your infrastructure  
⚡ **Developer experience** - Simple, TypeScript-native API  
🌍 **Production-ready** - Used by teams building the next generation of developer tools

### Perfect for building:

- **Code execution platforms** - Run user-submitted code safely
- **Educational tools** - Interactive coding environments
- **Data analysis applications** - Process code with full filesystem access
- **AI-powered development tools** - Let AI agents write and execute code
- **Testing & CI/CD systems** - Isolated test environments

## Features

🚀 **Multi-provider support** - E2B, Vercel, Daytona, Modal, CodeSandbox, Blaxel, and more  
📁 **Filesystem operations** - Read, write, create directories across providers  
⚡ **Command execution** - Run shell commands directly  
🛡️ **Type-safe** - Full TypeScript support with comprehensive error handling  
📦 **Modular** - Install only the providers you need  
🔧 **Extensible** - Easy to add custom providers  
🌐 **Web Framework Integration** - Built-in request handlers for Next.js, Nuxt, SvelteKit, etc.  
🎨 **Frontend Integration** - Client-side hooks and utilities via @computesdk/ui

## Quick Example

```typescript
import { compute } from 'computesdk';
import { e2b } from '@computesdk/e2b';

// Set default provider
compute.setConfig({ 
  defaultProvider: e2b({ apiKey: process.env.E2B_API_KEY }) 
});

// Create a sandbox
const sandbox = await compute.sandbox.create();

// Execute code
const result = await sandbox.runCode('print("Hello World!")');
console.log(result.stdout); // "Hello World!"

// Clean up
await compute.sandbox.destroy(sandbox.sandboxId);
```

## Next Steps

Ready to get started? Check out our [installation guide](./installation.md) or dive into the [quick start](./quick-start.md) to begin building with ComputeSDK.