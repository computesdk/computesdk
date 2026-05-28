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

const result = await sandbox.runCommand('python -c "print(\'Hello World!\')"');
console.log(result.stdout); // "Hello World!"

await sandbox.destroy();
```

## Features

- 🔄 **Multi-provider support** - E2B, Modal, Daytona, Vercel, and more
- 📁 **Filesystem operations** - Read, write, create directories across providers
- 🖥️ **Command execution** - Run shell commands in sandboxes
- 🧵 **Terminals** - Interactive (PTY) and exec-mode command tracking
- 🛡️ **Type-safe** - Full TypeScript support with comprehensive error handling
- 🔧 **Extensible** - Easy to add custom providers via [@computesdk/provider](./packages/provider)

## Supported Providers

Install provider packages and pass instances into `compute.setConfig`:

| Provider | Environment Variables | Use Cases |
|----------|----------------------|-----------|
| **Archil** | `ARCHIL_API_KEY` | Disk-attached command execution |
| **Arker** | `ARKER_API_KEY` | Sandboxed VMs with persistent filesystems, forked from golden images |
| **Beam** | `BEAM_TOKEN`, `BEAM_WORKSPACE_ID` | Serverless cloud sandboxes |
| **Blaxel** | `BL_API_KEY`, `BL_WORKSPACE` | Agent sandboxes with custom images |
| **Cloud Run** | `CLOUD_RUN_SANDBOX_URL`, `CLOUD_RUN_SANDBOX_SECRET` | Google Cloud Run sandboxes |
| **Cloudflare** | `CLOUDFLARE_SANDBOX_URL`, `CLOUDFLARE_SANDBOX_API_KEY` | Edge computing |
| **CodeSandbox** | `CSB_API_KEY` | Collaborative development |
| **CreateOS** | `CREATEOS_SANDBOX_API_KEY`, `CREATEOS_SANDBOX_BASE_URL` | VM sandboxes with pause/resume/fork snapshots |
| **Daytona** | `DAYTONA_API_KEY` | Development workspaces |
| **Declaw** | `DECLAW_API_KEY` | Isolated cloud sandboxes |
| **E2B** | `E2B_API_KEY` | Data science, Python/Node.js, interactive terminals |
| **HopX** | `HOPX_API_KEY` | Fast ephemeral sandboxes |
| **Isorun** | `ISORUN_API_KEY` | Code execution with snapshot support |
| **Lightning** | `LIGHTNING_API_KEY` | Cloud sandboxes for command execution and filesystem access |
| **Modal** | `MODAL_TOKEN_ID`, `MODAL_TOKEN_SECRET` | GPU computing, ML inference |
| **Northflank** | `NORTHFLANK_TOKEN`, `NORTHFLANK_PROJECT_ID` | Cloud sandboxes with preview URLs |
| **Runloop** | `RUNLOOP_API_KEY` | Code execution, automation |
| **Superserve** | `SUPERSERVE_API_KEY` | Firecracker microVM sandboxes |
| **Tensorlake** | `TENSORLAKE_API_KEY` | Stateful MicroVM sandboxes |
| **Upstash** | `UPSTASH_BOX_API_KEY` | Ephemeral and persistent sandboxes |
| **Vercel** | `VERCEL_TOKEN` or `VERCEL_OIDC_TOKEN` | Serverless functions |

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
await e2bSandbox.runCommand('python -c "import pandas as pd"');
await e2bSandbox.destroy();

// Switch to Modal for GPU workloads
compute.setConfig({
  provider: modal({
    tokenId: process.env.MODAL_TOKEN_ID,
    tokenSecret: process.env.MODAL_TOKEN_SECRET,
  }),
});

const modalSandbox = await compute.sandbox.create();
await modalSandbox.runCommand('python -c "import torch; print(torch.cuda.is_available())"');
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

### Command Execution

```typescript
// Execute Python code
const result = await sandbox.runCommand('python -c "print(\'Hello\')"');
console.log(result.stdout);
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

// Write the analysis script
await sandbox.filesystem.writeFile('/analysis/analyze.py', `
import json
import pandas as pd

df = pd.read_csv('/analysis/data/people.csv')
print(f"Average age: {df['age'].mean()}")

results = {'average_age': df['age'].mean()}
with open('/analysis/results.json', 'w') as f:
    json.dump(results, f)
`);

// Run it
const result = await sandbox.runCommand('python /analysis/analyze.py');
console.log(result.stdout);

// Read results
const results = await sandbox.filesystem.readFile('/analysis/results.json');
console.log('Results:', JSON.parse(results));

await sandbox.destroy();
```

## Provider Packages

Install the provider packages you need and pass their instances into `compute.setConfig`:

```bash
npm install @computesdk/archil           # Archil provider
npm install @computesdk/beam             # Beam provider
npm install @computesdk/blaxel           # Blaxel provider
npm install @computesdk/cloud-run        # Google Cloud Run provider
npm install @computesdk/cloudflare       # Cloudflare provider
npm install @computesdk/codesandbox      # CodeSandbox provider
npm install @computesdk/createos-sandbox # CreateOS VM sandbox provider
npm install @computesdk/daytona          # Daytona provider
npm install @computesdk/declaw           # Declaw provider
npm install @computesdk/e2b              # E2B provider
npm install @computesdk/hopx             # HopX provider
npm install @computesdk/isorun           # Isorun provider
npm install @computesdk/lightning        # Lightning AI provider
npm install @computesdk/modal            # Modal provider
npm install @computesdk/northflank       # Northflank provider
npm install @computesdk/runloop          # Runloop provider
npm install @computesdk/superserve       # Superserve provider
npm install @computesdk/tensorlake       # Tensorlake provider
npm install @computesdk/upstash          # Upstash provider
npm install @computesdk/vercel           # Vercel provider
```

You can also use a provider's callable form directly, bypassing `compute.setConfig`:

```typescript
import { e2b } from '@computesdk/e2b';

const e2bCompute = e2b({ apiKey: process.env.E2B_API_KEY });
const sandbox = await e2bCompute.sandbox.create();
```

See individual provider READMEs for details:
- **[@computesdk/archil](./packages/archil)** - Disk-attached command-execution sandboxes
- **[@computesdk/beam](./packages/beam)** - Serverless cloud sandboxes
- **[@computesdk/blaxel](./packages/blaxel)** - Agent sandboxes with custom images
- **[@computesdk/cloud-run](./packages/cloud-run)** - Google Cloud Run sandboxes
- **[@computesdk/cloudflare](./packages/cloudflare)** - Edge computing sandboxes
- **[@computesdk/codesandbox](./packages/codesandbox)** - Collaborative development
- **[@computesdk/createos-sandbox](./packages/createos-sandbox)** - NodeOps VM sandboxes, with pause/resume/fork snapshots and a native-handle escape hatch
- **[@computesdk/daytona](./packages/daytona)** - Development workspaces
- **[@computesdk/declaw](./packages/declaw)** - Isolated cloud sandboxes
- **[@computesdk/e2b](./packages/e2b)** - Data science, Python/Node.js, terminals
- **[@computesdk/hopx](./packages/hopx)** - Fast ephemeral sandboxes
- **[@computesdk/isorun](./packages/isorun)** - Code execution with snapshot support
- **[@computesdk/lightning](./packages/lightning)** - Lightning AI cloud sandboxes for command execution and filesystem access
- **[@computesdk/modal](./packages/modal)** - GPU computing, ML inference
- **[@computesdk/northflank](./packages/northflank)** - Cloud sandboxes with preview URLs
- **[@computesdk/runloop](./packages/runloop)** - Code execution, automation
- **[@computesdk/superserve](./packages/superserve)** - Firecracker microVM sandboxes
- **[@computesdk/tensorlake](./packages/tensorlake)** - Stateful MicroVM sandboxes for agentic applications, with snapshot support
- **[@computesdk/upstash](./packages/upstash)** - Ephemeral and persistent sandboxes
- **[@computesdk/vercel](./packages/vercel)** - Serverless functions

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
