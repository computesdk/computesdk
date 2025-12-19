<div align="center">
  <img src="https://www.computesdk.com/_astro/hv_main_logo_light.CpYMD9-V.svg" alt="ComputeSDK" width="300" />
</div>

<div align="center">
  <strong>A free and open-source toolkit for running other people's code in your applications.</strong>
</div>

<div align="center">

[![npm version](https://badge.fury.io/js/computesdk.svg)](https://badge.fury.io/js/computesdk)
[![TypeScript](https://img.shields.io/badge/TypeScript-100%25-blue.svg)](https://www.typescriptlang.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Documentation](https://img.shields.io/badge/docs-computesdk.com-blue)](https://computesdk.com)

</div>

---

> **New: ComputeSDK Gateway**
>
> The ComputeSDK Gateway provides a unified API for any sandbox provider. Zero-config mode auto-detects your provider from environment variables - no code changes needed to switch providers. [Learn more](#zero-config-mode)

## What is ComputeSDK?

ComputeSDK is a free and open-source toolkit for running other people's code in your applications. Think of it as the "AI SDK for compute" - providing a consistent TypeScript interface whether you're using Blaxel, E2B, Vercel, or Daytona.

**Why ComputeSDK?**
- 🔄 **Provider-agnostic** - Switch between Blaxel, E2B, Vercel, Daytona, Modal, CodeSandbox and more without code changes
- 🛡️ **Security-first** - Isolated sandboxes protect your infrastructure
- ⚡ **Developer experience** - Simple, TypeScript-native API
- 🌍 **Production-ready** - Used by teams building the next generation of developer tools

**Perfect for building:**
- **Code execution platforms** - Run user-submitted code safely
- **Educational tools** - Interactive coding environments  
- **Data analysis applications** - Process code with full filesystem access
- **AI-powered development tools** - Let AI agents write and execute code
- **Testing & CI/CD systems** - Isolated test environments

## Features

- 🚀 **Multi-provider support** - Blaxel, E2B, Vercel, Daytona, Modal, CodeSandbox
- ⚡ **Zero-config mode** - Auto-detect provider from environment variables
- 📁 **Filesystem operations** - Read, write, create directories across providers
- 🖥️ **Command execution** - Run shell commands with PTY or exec mode
- 🔧 **Type-safe commands** - Build shell commands with `@computesdk/cmd`
- 🛡️ **Type-safe** - Full TypeScript support with comprehensive error handling
- 📦 **Modular** - Install only the providers you need
- 🔧 **Extensible** - Easy to add custom providers
- 🌐 **Web Framework Integration** - Built-in request handlers for Next.js, Nuxt, SvelteKit, etc.
- 🎨 **Frontend Integration** - Client-side hooks and utilities via @computesdk/ui

## Get Started in 30 Seconds

```bash
# Install the core SDK
npm install computesdk

# Add your preferred provider
npm install @computesdk/blaxel     # For AI-powered code execution
npm install @computesdk/e2b        # For data science and Python
npm install @computesdk/vercel     # For web-scale Node.js/Python  
npm install @computesdk/daytona    # For development workspaces
npm install @computesdk/modal      # For GPU-accelerated Python workloads
npm install @computesdk/codesandbox # For collaborative sandboxes

# Frontend integration (optional)
npm install @computesdk/ui         # React hooks and utilities
```

Set your environment variables and you're ready to go:

```bash
export BLAXEL_API_KEY=your_api_key
export BLAXEL_WORKSPACE=your_workspace
# or E2B_API_KEY=your_api_key
# or VERCEL_TOKEN=your_token
# or DAYTONA_API_KEY=your_key
# or MODAL_TOKEN_ID=your_token_id and MODAL_TOKEN_SECRET=your_token_secret
# or CODESANDBOX_TOKEN=your_token
```

## Quick Start

```typescript
import { compute } from 'computesdk';
import { blaxel } from '@computesdk/blaxel';

// Set default provider
compute.setConfig({
  provider: blaxel({
    apiKey: process.env.BLAXEL_API_KEY,
    workspace: process.env.BLAXEL_WORKSPACE
  })
});

// Create a sandbox
const sandbox = await compute.sandbox.create();

// Execute code
const result = await sandbox.runCode('print("Hello World!")');
console.log(result.stdout); // "Hello World!"

// Clean up
await compute.sandbox.destroy(sandbox.sandboxId);
```

## Zero-Config Mode

ComputeSDK can automatically detect and configure your provider from environment variables:

```bash
# Set your ComputeSDK API key
export COMPUTESDK_API_KEY=your_computesdk_api_key

# Set credentials for your provider (auto-detected)
export E2B_API_KEY=your_e2b_key
# or export DAYTONA_API_KEY=your_daytona_key
# or export MODAL_TOKEN_ID=xxx MODAL_TOKEN_SECRET=xxx
```

```typescript
import { compute } from 'computesdk';

// No provider configuration needed - auto-detected from environment!
const sandbox = await compute.sandbox.create();
const result = await sandbox.runCode('print("Hello World!")');
console.log(result.stdout);
```

Provider detection order: E2B → Railway → Daytona → Modal → Runloop → Vercel → Cloudflare → CodeSandbox → Blaxel

You can also explicitly set the provider:

```bash
export COMPUTESDK_PROVIDER=e2b
```

## Provider Setup

### Blaxel - AI-Powered Code Execution

Blaxel provides intelligent code execution with AI assistance:

```bash
export BLAXEL_API_KEY=your_blaxel_api_key_here
export BLAXEL_WORKSPACE=your_workspace_here
```

```typescript
import { compute } from 'computesdk';
import { blaxel } from '@computesdk/blaxel';

compute.setConfig({
  provider: blaxel({
    apiKey: process.env.BLAXEL_API_KEY,
    workspace: process.env.BLAXEL_WORKSPACE
  })
});

const sandbox = await compute.sandbox.create();

// Execute code with AI assistance
const result = await sandbox.runCode(`
print("Hello from Blaxel!")
# Your code can leverage AI capabilities
import json
data = {"message": "AI-powered execution"}
print(json.dumps(data, indent=2))
`);

console.log(result.stdout);
```

### E2B

```bash
export E2B_API_KEY=e2b_your_api_key_here
```

```typescript
import { compute } from 'computesdk';
import { e2b } from '@computesdk/e2b';

compute.setConfig({ 
  provider: e2b({ apiKey: process.env.E2B_API_KEY }) 
});

const sandbox = await compute.sandbox.create();

// Execute Python with data science libraries
const result = await sandbox.runCode(`
import pandas as pd
import numpy as np

data = {'A': [1, 2, 3], 'B': [4, 5, 6]}
df = pd.DataFrame(data)
print(df)
print(f"Sum: {df.sum().sum()}")
`);
```

### Vercel

Vercel provides reliable execution with filesystem support:

```bash
# Method 1: OIDC Token (Recommended)
vercel env pull  # Downloads VERCEL_OIDC_TOKEN

# Method 2: Traditional
export VERCEL_TOKEN=your_vercel_token_here
export VERCEL_TEAM_ID=your_team_id_here
export VERCEL_PROJECT_ID=your_project_id_here
```

```typescript
import { compute } from 'computesdk';
import { vercel } from '@computesdk/vercel';

compute.setConfig({ 
  provider: vercel({ runtime: 'node' }) 
});

const sandbox = await compute.sandbox.create();

// Execute Node.js or Python
const result = await sandbox.runCode(`
console.log('Node.js version:', process.version);
console.log('Hello from Vercel!');
`);

// Up to 45 minutes execution time
// Global infrastructure deployment
```

### Daytona

Daytona provides development workspace environments:

```bash
export DAYTONA_API_KEY=your_daytona_api_key_here
```

```typescript
import { compute } from 'computesdk';
import { daytona } from '@computesdk/daytona';

compute.setConfig({ 
  provider: daytona({ apiKey: process.env.DAYTONA_API_KEY }) 
});

const sandbox = await compute.sandbox.create();

// Execute in development workspace
const result = await sandbox.runCode(`
print('Hello from Daytona!')
import sys
print(f'Python version: {sys.version}')
`);
```

### Modal

Modal provides powerful cloud compute with GPU support:

```bash
export MODAL_TOKEN_ID=your_modal_token_id_here
export MODAL_TOKEN_SECRET=your_modal_token_secret_here
```

```typescript
import { compute } from 'computesdk';
import { modal } from '@computesdk/modal';

compute.setConfig({ 
  provider: modal({ 
    tokenId: process.env.MODAL_TOKEN_ID,
    tokenSecret: process.env.MODAL_TOKEN_SECRET 
  }) 
});

const sandbox = await compute.sandbox.create();

// Execute GPU-accelerated Python workloads
const result = await sandbox.runCode(`
import torch
print(f'PyTorch version: {torch.__version__}')
print(f'CUDA available: {torch.cuda.is_available()}')

# Example GPU computation
if torch.cuda.is_available():
    x = torch.rand(1000, 1000).cuda()
    y = torch.mm(x, x)
    print(f'GPU computation result shape: {y.shape}')
else:
    print('Running on CPU')
`);
```

### CodeSandbox

CodeSandbox provides collaborative sandbox environments:

```bash
export CODESANDBOX_TOKEN=your_codesandbox_token_here
```

```typescript
import { compute } from 'computesdk';
import { codesandbox } from '@computesdk/codesandbox';

compute.setConfig({ 
  provider: codesandbox({ 
    apiToken: process.env.CODESANDBOX_TOKEN 
  }) 
});

const sandbox = await compute.sandbox.create();

// Execute in collaborative environment
const result = await sandbox.runCode(`
print('Hello from CodeSandbox!')
import os
print(f'Environment: {os.environ.get("SANDBOX_ID", "local")}')

# Access to popular Python libraries
import requests
import numpy as np
print(f'NumPy version: {np.__version__}')
`);
```

## Core API

### Configuration

```typescript
import { compute } from 'computesdk';

// Set default provider
compute.setConfig({ provider: myProvider });

// Get current config
const config = compute.getConfig();

// Clear config
compute.clearConfig();
```

### Sandbox Management

```typescript
// Create sandbox with explicit provider
const sandbox = await compute.sandbox.create({
  provider: e2b({ apiKey: 'your-key' }),
  options: { runtime: 'python', timeout: 300000 }
});

// Create sandbox with default provider
const sandbox = await compute.sandbox.create({
  options: { runtime: 'python' }
});

// Get existing sandbox
const sandbox = await compute.sandbox.getById('sandbox-id');

// List all sandboxes
const sandboxes = await compute.sandbox.list();

// Destroy sandbox
await compute.sandbox.destroy('sandbox-id');
```

### Code Execution

```typescript
// Run code
const result = await sandbox.runCode('print("Hello")', 'python');

// Run shell command
const result = await sandbox.runCommand('ls', ['-la']);

// Result structure
interface ExecutionResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  executionTime: number;
  sandboxId: string;
  provider: string;
}
```

### Filesystem Operations

```typescript
// Write file
await sandbox.filesystem.writeFile('/tmp/hello.py', 'print("Hello")');

// Read file
const content = await sandbox.filesystem.readFile('/tmp/hello.py');

// Create directory
await sandbox.filesystem.mkdir('/tmp/mydir');

// List directory
const files = await sandbox.filesystem.readdir('/tmp');

// Check if exists
const exists = await sandbox.filesystem.exists('/tmp/hello.py');

// Remove file/directory
await sandbox.filesystem.remove('/tmp/hello.py');
```

## Web Framework Integration

ComputeSDK provides built-in request handlers for web frameworks:

```typescript
import { handleComputeRequest } from 'computesdk';
import { blaxel } from '@computesdk/blaxel';

// Next.js API route
export async function POST(request: Request) {
  return handleComputeRequest({
    request,
    provider: blaxel({ 
      apiKey: process.env.BLAXEL_API_KEY,
      workspace: process.env.BLAXEL_WORKSPACE
    })
  });
}

// Client usage
const response = await fetch('/api/compute', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    action: 'compute.sandbox.runCode',
    code: 'print("Hello from web!")',
    runtime: 'python'
  })
});

const result = await response.json();
console.log(result.result.stdout);
```

### Supported Actions

- `compute.sandbox.create` - Create new sandbox
- `compute.sandbox.destroy` - Destroy sandbox
- `compute.sandbox.getInfo` - Get sandbox information
- `compute.sandbox.list` - List all sandboxes
- `compute.sandbox.runCode` - Execute code
- `compute.sandbox.runCommand` - Run shell command
- `compute.sandbox.filesystem.readFile` - Read file
- `compute.sandbox.filesystem.writeFile` - Write file
- `compute.sandbox.filesystem.mkdir` - Create directory
- `compute.sandbox.filesystem.readdir` - List directory
- `compute.sandbox.filesystem.exists` - Check if path exists
- `compute.sandbox.filesystem.remove` - Remove file/directory

## Frontend Integration

Use `@computesdk/ui` for framework-agnostic factory functions:

```typescript
import { createCompute, createSandboxConsole } from '@computesdk/ui';

function CodeExecutor() {
  const compute = createCompute({
    apiEndpoint: '/api/compute',
    defaultRuntime: 'python'
  });
  
  const executeCode = async () => {
    const sandbox = await compute.sandbox.create();
    const result = await sandbox.runCode('print("Hello World!")');
    console.log(result.result?.stdout);
    await sandbox.destroy();
  };
  
  return (
    <button onClick={executeCode}>
      Execute Code
    </button>
  );
}
```

## Error Handling

```typescript
try {
  const sandbox = await compute.sandbox.create();
  const result = await sandbox.runCode('invalid code');
} catch (error) {
  console.error('Execution failed:', error.message);
}
```

## Examples

### Data Science with E2B

```typescript
import { compute } from 'computesdk';
import { e2b } from '@computesdk/e2b';

compute.setConfig({ provider: e2b({ apiKey: process.env.E2B_API_KEY }) });

const sandbox = await compute.sandbox.create();

// Create project structure
await sandbox.filesystem.mkdir('/analysis');
await sandbox.filesystem.mkdir('/analysis/data');
await sandbox.filesystem.mkdir('/analysis/output');

// Write input data
const csvData = `name,age,city
Alice,25,New York
Bob,30,San Francisco
Charlie,35,Chicago`;

await sandbox.filesystem.writeFile('/analysis/data/people.csv', csvData);

// Process data with Python
const result = await sandbox.runCode(`
import pandas as pd
import matplotlib.pyplot as plt

# Read data
df = pd.read_csv('/analysis/data/people.csv')
print("Data loaded:")
print(df)

# Calculate statistics
avg_age = df['age'].mean()
print(f"\\nAverage age: {avg_age}")

# Create visualization
plt.figure(figsize=(8, 6))
plt.bar(df['name'], df['age'])
plt.title('Age by Person')
plt.xlabel('Name')
plt.ylabel('Age')
plt.savefig('/analysis/output/age_chart.png')
print("\\nChart saved to /analysis/output/age_chart.png")

# Save results
results = {
    'total_people': len(df),
    'average_age': avg_age,
    'cities': df['city'].unique().tolist()
}

import json
with open('/analysis/output/results.json', 'w') as f:
    json.dump(results, f, indent=2)

print("Results saved!")
`);

console.log(result.stdout);

// Read the results
const results = await sandbox.filesystem.readFile('/analysis/output/results.json');
console.log('Analysis results:', JSON.parse(results));

await compute.sandbox.destroy(sandbox.sandboxId);
```

### Cross-Provider Data Processing

```typescript
import { compute } from 'computesdk';
import { blaxel } from '@computesdk/blaxel';
import { vercel } from '@computesdk/vercel';
import { daytona } from '@computesdk/daytona';
import { modal } from '@computesdk/modal';
import { codesandbox } from '@computesdk/codesandbox';

async function processData(provider: any) {
  compute.setConfig({ provider });
  
  const sandbox = await compute.sandbox.create();
  
  // Create workspace
  await sandbox.filesystem.mkdir('/workspace');
  
  // Write input data
  await sandbox.filesystem.writeFile('/workspace/input.json', 
    JSON.stringify({ numbers: [1, 2, 3, 4, 5] })
  );
  
  // Process with code execution
  const result = await sandbox.runCode(`
import json

# Read input
with open('/workspace/input.json', 'r') as f:
    data = json.load(f)

# Process
numbers = data['numbers']
result = {
    'sum': sum(numbers),
    'average': sum(numbers) / len(numbers),
    'count': len(numbers)
}

# Write output
with open('/workspace/output.json', 'w') as f:
    json.dump(result, f, indent=2)

print("Processing complete!")
  `);
  
  // Read results
  const output = await sandbox.filesystem.readFile('/workspace/output.json');
  await compute.sandbox.destroy(sandbox.sandboxId);
  
  return JSON.parse(output);
}

// Use with different providers
const blaxelResult = await processData(blaxel({ 
  apiKey: process.env.BLAXEL_API_KEY,
  workspace: process.env.BLAXEL_WORKSPACE
}));
console.log('Blaxel result:', blaxelResult);

const vercelResult = await processData(vercel({ runtime: 'python' }));
console.log('Vercel result:', vercelResult);

const daytonaResult = await processData(daytona({ runtime: 'python' }));
console.log('Daytona result:', daytonaResult);

const modalResult = await processData(modal({ 
  tokenId: process.env.MODAL_TOKEN_ID,
  tokenSecret: process.env.MODAL_TOKEN_SECRET 
}));
console.log('Modal result:', modalResult);

const codesandboxResult = await processData(codesandbox({ 
  apiToken: process.env.CODESANDBOX_TOKEN 
}));
console.log('CodeSandbox result:', codesandboxResult);
```

## Provider Packages

ComputeSDK uses separate provider packages:

```bash
npm install @computesdk/blaxel     # Blaxel provider
npm install @computesdk/e2b        # E2B provider
npm install @computesdk/vercel     # Vercel provider
npm install @computesdk/daytona    # Daytona provider
npm install @computesdk/modal      # Modal provider
npm install @computesdk/codesandbox # CodeSandbox provider
```

Each provider implements the same interface but may support different capabilities (filesystem, etc.).

## Utility Packages

Additional packages for enhanced functionality:

```bash
npm install @computesdk/cmd        # Type-safe shell command builders
npm install @computesdk/client     # Universal sandbox client (browser/Node.js)
npm install @computesdk/events     # Event storage and real-time streaming
npm install @computesdk/workbench  # Interactive REPL for sandbox testing
```

### @computesdk/cmd - Type-Safe Commands

Build shell commands with full TypeScript support:

```typescript
import { npm, git, mkdir, cmd } from '@computesdk/cmd';

// Type-safe command builders
await sandbox.runCommand(npm.install('express'));
await sandbox.runCommand(git.clone('https://github.com/user/repo'));
await sandbox.runCommand(mkdir('/app/src'));

// With options
await sandbox.runCommand(cmd(npm.run('dev'), { cwd: '/app', background: true }));
```

### @computesdk/workbench - Interactive REPL

Test sandbox operations interactively:

```bash
npx workbench

# Commands autocomplete!
workbench> npm.install('express')
workbench> git.clone('https://github.com/user/repo')
workbench> ls('/home')
```

## Custom Providers

Create custom providers using the factory:

```typescript
import { createProvider } from 'computesdk';

const myProvider = createProvider({
  name: 'my-provider',
  methods: {
    sandbox: {
      create: async (config, options) => {
        // Implementation
      },
      getById: async (config, id) => {
        // Implementation  
      },
      list: async (config) => {
        // Implementation
      },
      destroy: async (config, id) => {
        // Implementation
      }
    }
  }
});
```

## TypeScript Support

ComputeSDK is fully typed with comprehensive TypeScript definitions:

```typescript
import type { 
  Sandbox, 
  Provider, 
  ExecutionResult,
  ComputeConfig,
  Runtime 
} from 'computesdk';
```

## Provider Comparison

| Provider | Code Execution | Filesystem | Terminal | Use Cases |
|----------|----------------|------------|----------|-----------|
| **Blaxel** | Python, Node.js, TypeScript | ✅ Full | ❌ | AI code generation, AI code review, AI data analysis |
| **E2B** | Python, Node.js | ✅ Full | ✅ PTY | Data science, AI/ML, interactive development |
| **Vercel** | Node.js, Python | ✅ Full | ❌ | Web apps, APIs, serverless functions |
| **Daytona** | Python, Node.js | ✅ Full | ❌ | Development workspaces, custom environments |
| **Modal** | Python | ✅ Full | ❌ | GPU computing, ML inference, large-scale Python workloads |
| **CodeSandbox** | JavaScript, Python | ✅ Full | ❌ | Collaborative development, web development, prototyping |

### Key Differences

- **Blaxel**: Sandboxes with 25ms boot times, autoscale-to-zero after 5s inactivity, and persistent storage
- **E2B**: Full development environment with data science libraries and interactive terminals
- **Vercel**: Ephemeral sandboxes optimized for serverless execution (up to 45 minutes)
- **Daytona**: Development workspaces with persistent environments
- **Modal**: GPU-accelerated cloud compute optimized for ML and data-intensive Python workloads
- **CodeSandbox**: Collaborative browser-based development environments with instant sharing

## Examples

Check out the [examples directory](./examples) for complete implementations with different web frameworks:

- [Next.js](./examples/nextjs)
- [Nuxt](./examples/nuxt) 
- [SvelteKit](./examples/sveltekit)
- [Remix](./examples/remix)
- [Astro](./examples/astro)

## Resources

- 📖 **[Full Documentation](https://computesdk.com)** - Complete guides and API reference
- 🚀 **[Getting Started](https://computesdk.com/getting-started)** - Quick setup guide
- 💡 **[Examples](./examples)** - Real-world usage examples
- 🎯 **[Providers](https://computesdk.com/providers)** - Provider-specific guides

## Contributing

ComputeSDK is open source and welcomes contributions! Whether you're fixing bugs, adding features, or improving documentation, we'd love your help.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## Community & Support

- 💬 **[GitHub Discussions](https://github.com/computesdk/computesdk/discussions)** - Ask questions and share ideas
- 🐛 **[GitHub Issues](https://github.com/computesdk/computesdk/issues)** - Report bugs and request features
- 📧 **[Contact Us](https://computesdk.com/contact)** - Get in touch with the team

## License

MIT License - see the [LICENSE](LICENSE) file for details.

---

<div align="center">
  <strong>Built with ❤️ by the ComputeSDK team</strong><br>
  <a href="https://computesdk.com">computesdk.com</a>
</div>
