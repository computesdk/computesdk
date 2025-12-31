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

- 🚀 **Multi-provider support** - E2B, Modal, Vercel, Daytona, Railway, and more
- ⚡ **Zero-config mode** - Auto-detect provider from environment variables
- 📁 **Filesystem operations** - Read, write, create directories across providers
- 🖥️ **Command execution** - Run shell commands with PTY or exec mode
- 🛡️ **Type-safe** - Full TypeScript support with comprehensive error handling
- 📦 **Modular** - Install only the providers you need
- 🔧 **Extensible** - Easy to add custom providers via [@computesdk/provider](./packages/provider)

## Get Started in 30 Seconds

```bash
# Install the core SDK
npm install computesdk

# Add your preferred provider (optional - auto-detects from env vars)
npm install @computesdk/e2b        # For data science and Python
npm install @computesdk/modal      # For GPU-accelerated Python workloads
npm install @computesdk/vercel     # For web-scale Node.js/Python  
npm install @computesdk/daytona    # For development workspaces
npm install @computesdk/railway    # For Railway deployments
```

Set your environment variables and you're ready to go:

```bash
export E2B_API_KEY=your_api_key
# or MODAL_TOKEN_ID=your_token_id and MODAL_TOKEN_SECRET=your_token_secret
# or VERCEL_TOKEN=your_token
# or DAYTONA_API_KEY=your_key
# or RAILWAY_TOKEN=your_token
```

## Quick Start

```typescript
import { compute } from 'computesdk';

// No configuration needed - auto-detects provider from environment!
const sandbox = await compute.sandbox.create();

// Execute code
const result = await sandbox.runCode('print("Hello World!")');
console.log(result.stdout); // "Hello World!"

// Clean up
await sandbox.destroy();
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

## Supported Providers

ComputeSDK automatically detects and uses providers based on your environment variables:

| Provider | Environment Variables | Use Cases |
|----------|----------------------|-----------|
| **E2B** | `E2B_API_KEY` | Data science, Python/Node.js, interactive terminals |
| **Modal** | `MODAL_TOKEN_ID`, `MODAL_TOKEN_SECRET` | GPU computing, ML inference, Python workloads |
| **Railway** | `RAILWAY_TOKEN` | Full-stack deployments, persistent storage |
| **Daytona** | `DAYTONA_API_KEY` | Development workspaces, custom environments |
| **Runloop** | `RUNLOOP_API_KEY` | Code execution, automation |
| **Vercel** | `VERCEL_TOKEN` or `VERCEL_OIDC_TOKEN` | Serverless functions, web apps |
| **Cloudflare** | `CLOUDFLARE_API_TOKEN` | Edge computing |
| **CodeSandbox** | `CODESANDBOX_TOKEN` | Collaborative development |

### Provider Detection Order

When you create a sandbox, ComputeSDK automatically detects your provider in this order:

**E2B → Railway → Daytona → Modal → Runloop → Vercel → Cloudflare → CodeSandbox**

You can override detection by setting `COMPUTESDK_PROVIDER`:

```bash
export COMPUTESDK_PROVIDER=modal  # Force using Modal
```

## Core API

### Sandbox Management

```typescript
import { compute } from 'computesdk';

// Create sandbox (auto-detects provider from environment)
const sandbox = await compute.sandbox.create();

// Create sandbox with specific options
const sandbox = await compute.sandbox.create({
  runtime: 'python',
  timeout: 300000
});

// Get existing sandbox by ID
const sandbox = await compute.sandbox.getById('sandbox-id');

// List all sandboxes
const sandboxes = await compute.sandbox.list();

// Destroy sandbox
await sandbox.destroy();
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

### Data Science Example

```typescript
import { compute } from 'computesdk';

// Assumes E2B_API_KEY is set in environment
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

await sandbox.destroy();
```

## Building Custom Providers

Want to add support for a new compute provider? Check out **[@computesdk/provider](./packages/provider)** - the provider framework that makes it easy to build custom providers.

```typescript
import { defineProvider } from '@computesdk/provider';

export const myProvider = defineProvider({
  name: 'my-provider',
  defaultMode: 'direct',
  sandbox: {
    create: async (config, options) => {
      // Your implementation here
    }
    // ... other methods
  }
});
```

See the [@computesdk/provider README](./packages/provider) for complete documentation on building custom providers.

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
