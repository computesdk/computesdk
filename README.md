<div align="center">
  <img src="https://www.computesdk.com/_astro/hv_main_logo_light.CpYMD9-V.svg" alt="ComputeSDK" width="300" />
</div>

<div align="center">
  <strong>A unified SDK for running code in remote sandboxes.</strong>
</div>

<div align="center">

[![npm version](https://badge.fury.io/js/computesdk.svg)](https://badge.fury.io/js/computesdk)
[![TypeScript](https://img.shields.io/badge/TypeScript-100%25-blue.svg)](https://www.typescriptlang.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Documentation](https://img.shields.io/badge/docs-computesdk.com-blue)](https://computesdk.com)

</div>

---

## What is ComputeSDK?

ComputeSDK provides a consistent TypeScript interface for executing code in remote sandboxes. Whether you're using E2B for data science, Modal for GPU workloads, or Vercel for serverless functions - ComputeSDK provides one unified API.

**Perfect for:**
- 🤖 AI code execution agents
- 📊 Data science platforms
- 🎓 Educational coding environments
- 🧪 Testing & CI/CD systems
- 🔧 Developer tools

## Quick Start

```bash
npm install computesdk @computesdk/e2b
```

Configure a provider and use the SDK:

```typescript
import { compute } from 'computesdk';
import { e2b } from '@computesdk/e2b';

compute.setConfig({
  provider: e2b({ apiKey: process.env.E2B_API_KEY }),
});

const sandbox = await compute.sandbox.create();

const result = await sandbox.runCode('print("Hello World!")');
console.log(result.output); // "Hello World!"

await sandbox.destroy();
```

## Features

- 🔄 **Multi-provider support** - E2B, Modal, Railway, Daytona, Vercel, and more
- 📁 **Filesystem operations** - Read, write, create directories across providers
- 🖥️ **Command execution** - Run shell commands in sandboxes
- 🧵 **Terminals** - Interactive (PTY) and exec-mode command tracking
- 🛡️ **Type-safe** - Full TypeScript support with comprehensive error handling
- 🔧 **Extensible** - Easy to add custom providers via [@computesdk/provider](./packages/provider)

## Supported Providers

Install provider packages and pass instances into `compute.setConfig`:

| Provider | Environment Variables | Use Cases |
|----------|----------------------|-----------|
| **E2B** | `E2B_API_KEY` | Data science, Python/Node.js, interactive terminals |
| **Modal** | `MODAL_TOKEN_ID`, `MODAL_TOKEN_SECRET` | GPU computing, ML inference |
| **Railway** | `RAILWAY_API_KEY`, `RAILWAY_PROJECT_ID`, `RAILWAY_ENVIRONMENT_ID` | Full-stack deployments |
| **Daytona** | `DAYTONA_API_KEY` | Development workspaces |
| **Runloop** | `RUNLOOP_API_KEY` | Code execution, automation |
| **Vercel** | `VERCEL_TOKEN` or `VERCEL_OIDC_TOKEN` | Serverless functions |
| **Cloudflare** | `CLOUDFLARE_SANDBOX_URL`, `CLOUDFLARE_SANDBOX_SECRET` | Edge computing |
| **CodeSandbox** | `CSB_API_KEY` | Collaborative development |

## Configuration

### Direct Provider Mode

Pass a provider instance directly to `setConfig()`:

```typescript
import { compute } from 'computesdk';
import { e2b } from '@computesdk/e2b';

compute.setConfig({
  provider: e2b({ apiKey: process.env.E2B_API_KEY }),
});

const sandbox = await compute.sandbox.create();
```

### Multi-Provider Configuration

Configure multiple providers for resilience and routing:

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
  providerStrategy: 'priority', // or 'round-robin'
  fallbackOnError: true,
});

// Uses configured strategy
const sandbox = await compute.sandbox.create();

// Force a specific provider for one call
const modalSandbox = await compute.sandbox.create({ provider: 'modal' });
```

### Switching Providers at Runtime

```typescript
import { compute } from 'computesdk';
import { e2b } from '@computesdk/e2b';
import { modal } from '@computesdk/modal';

// Use E2B for data science
compute.setConfig({
  provider: e2b({ apiKey: process.env.E2B_API_KEY }),
});

const e2bSandbox = await compute.sandbox.create();
await e2bSandbox.runCode('import pandas as pd');
await e2bSandbox.destroy();

// Switch to Modal for GPU workloads
compute.setConfig({
  provider: modal({
    tokenId: process.env.MODAL_TOKEN_ID,
    tokenSecret: process.env.MODAL_TOKEN_SECRET,
  }),
});

const modalSandbox = await compute.sandbox.create();
await modalSandbox.runCode('import torch; print(torch.cuda.is_available())');
await modalSandbox.destroy();
```

## Core API

### Sandbox Management

```typescript
// Create sandbox
const sandbox = await compute.sandbox.create();

// Create with options
const sandbox = await compute.sandbox.create({
  runtime: 'python',
  timeout: 300000,
  metadata: { userId: '123' }
});

// Get existing sandbox
const sandbox = await compute.sandbox.getById('sandbox-id');

// List sandboxes
const sandboxes = await compute.sandbox.list();

// Destroy sandbox
await sandbox.destroy();
```

### Code Execution

```typescript
// Execute code
const result = await sandbox.runCode('print("Hello")', 'python');
console.log(result.output);
console.log(result.exitCode);

// Run shell commands
const cmd = await sandbox.runCommand('npm install express');
console.log(cmd.stdout);
console.log(cmd.exitCode);
```

### Filesystem Operations

```typescript
// Write file
await sandbox.filesystem.writeFile('/tmp/hello.py', 'print("Hello")');

// Read file
const content = await sandbox.filesystem.readFile('/tmp/hello.py');

// Create directory
await sandbox.filesystem.mkdir('/tmp/data');

// List directory
const files = await sandbox.filesystem.readdir('/tmp');

// Check if exists
const exists = await sandbox.filesystem.exists('/tmp/hello.py');

// Remove
await sandbox.filesystem.remove('/tmp/hello.py');
```

## Example: Data Science Workflow

```typescript
import { compute } from 'computesdk';

const sandbox = await compute.sandbox.create({ runtime: 'python' });

// Create project structure
await sandbox.filesystem.mkdir('/analysis');
await sandbox.filesystem.mkdir('/analysis/data');

// Write input data
const csvData = `name,age,city
Alice,25,New York
Bob,30,San Francisco`;

await sandbox.filesystem.writeFile('/analysis/data/people.csv', csvData);

// Process data
const result = await sandbox.runCode(`
import pandas as pd

df = pd.read_csv('/analysis/data/people.csv')
print(f"Average age: {df['age'].mean()}")

# Save results
results = {'average_age': df['age'].mean()}

import json
with open('/analysis/results.json', 'w') as f:
    json.dump(results, f)
`);

console.log(result.stdout);

// Read results
const results = await sandbox.filesystem.readFile('/analysis/results.json');
console.log('Results:', JSON.parse(results));

await sandbox.destroy();
```

## Provider Packages

Install the provider packages you need and pass their instances into `compute.setConfig`:

```bash
npm install @computesdk/e2b        # E2B provider
npm install @computesdk/modal      # Modal provider
npm install @computesdk/railway    # Railway provider
npm install @computesdk/daytona    # Daytona provider
npm install @computesdk/vercel     # Vercel provider
npm install @computesdk/just-bash  # Local bash sandbox (no auth needed)
```

You can also use a provider's callable form directly, bypassing `compute.setConfig`:

```typescript
import { e2b } from '@computesdk/e2b';

const e2bCompute = e2b({ apiKey: process.env.E2B_API_KEY });
const sandbox = await e2bCompute.sandbox.create();
```

See individual provider READMEs for details:
- **[@computesdk/e2b](./packages/e2b)** - Data science, Python/Node.js, terminals
- **[@computesdk/modal](./packages/modal)** - GPU computing, ML inference
- **[@computesdk/railway](./packages/railway)** - Full-stack deployments
- **[@computesdk/daytona](./packages/daytona)** - Development workspaces
- **[@computesdk/vercel](./packages/vercel)** - Serverless functions
- **[@computesdk/just-bash](./packages/just-bash)** - Local bash sandbox with virtual filesystem (no auth required)

## Building Custom Providers

Want to add support for a new compute provider? See **[@computesdk/provider](./packages/provider)** for the provider framework:

```typescript
import { defineProvider } from '@computesdk/provider';

export const myProvider = defineProvider({
  name: 'my-provider',
  defaultMode: 'direct',
  methods: {
    sandbox: {
      create: async (config, options) => {
        // Your implementation
      },
      // ... other methods
    }
  }
});
```

## Examples

Check out the [examples directory](./examples) for complete implementations:

- **[Next.js](./examples/nextjs)** - API routes with ComputeSDK
- **[Nuxt](./examples/nuxt)** - Server API integration
- **[SvelteKit](./examples/sveltekit)** - Endpoints with ComputeSDK
- **[Remix](./examples/remix)** - Loader/action integration
- **[Astro](./examples/astro)** - API endpoints

## Documentation

- 📖 **[Full Documentation](https://computesdk.com)** - Complete guides and API reference
- 🚀 **[Getting Started](https://computesdk.com/getting-started)** - Quick setup guide
- 🎯 **[Providers](./packages)** - Provider-specific documentation

## TypeScript Support

Full TypeScript support with comprehensive type definitions:

```typescript
import type { 
  Sandbox,
  SandboxInfo,
  CodeResult,
  CommandResult,
  CreateSandboxOptions
} from 'computesdk';
```

## Contributing

ComputeSDK is open source and welcomes contributions!

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## Community & Support

- 💬 **[GitHub Discussions](https://github.com/computesdk/computesdk/discussions)** - Ask questions and share ideas
- 🐛 **[GitHub Issues](https://github.com/computesdk/computesdk/issues)** - Report bugs and request features

## License

MIT License - see the [LICENSE](LICENSE) file for details.

---

<div align="center">

**Built with ❤️ by the ComputeSDK team**

[computesdk.com](https://computesdk.com)

</div>
