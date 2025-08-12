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

## What is ComputeSDK?

ComputeSDK is a unified abstraction layer that lets you execute code in secure, isolated sandboxed environments across multiple cloud providers. Think of it as the "Vercel AI SDK for compute" - providing a consistent TypeScript interface whether you're using E2B, Vercel, or Daytona.

**Why ComputeSDK?**
- 🔄 **Provider-agnostic** - Switch between E2B, Vercel, Daytona and more (coming soon) without code changes
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

- 🚀 **Multi-provider support** - E2B, Vercel, Daytona
- 📁 **Filesystem operations** - Read, write, create directories across providers
- 🖥️ **Terminal support** - Interactive PTY terminals (E2B)
- ⚡ **Command execution** - Run shell commands directly
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
npm install @computesdk/e2b        # For data science and Python
npm install @computesdk/vercel     # For web-scale Node.js/Python  
npm install @computesdk/daytona    # For development workspaces

# Frontend integration (optional)
npm install @computesdk/ui         # React hooks and utilities
```

Set your environment variables and you're ready to go:

```bash
export E2B_API_KEY=your_api_key
# or VERCEL_TOKEN=your_token
# or DAYTONA_API_KEY=your_key
```

## Quick Start

```typescript
import { compute } from 'computesdk';
import { e2b } from '@computesdk/e2b';

// Set default provider
compute.setConfig({ 
  provider: e2b({ apiKey: process.env.E2B_API_KEY }) 
});

// Create a sandbox
const sandbox = await compute.sandbox.create({});

// Execute code
const result = await sandbox.runCode('print("Hello World!")');
console.log(result.stdout); // "Hello World!"

// Clean up
await compute.sandbox.destroy(sandbox.sandboxId);
```

## Provider Setup

### E2B - Full Development Environment

E2B provides full filesystem and terminal support:

```bash
export E2B_API_KEY=e2b_your_api_key_here
```

```typescript
import { compute } from 'computesdk';
import { e2b } from '@computesdk/e2b';

compute.setConfig({ 
  provider: e2b({ apiKey: process.env.E2B_API_KEY }) 
});

const sandbox = await compute.sandbox.create({});

// Execute Python with data science libraries
const result = await sandbox.runCode(`
import pandas as pd
import numpy as np

data = {'A': [1, 2, 3], 'B': [4, 5, 6]}
df = pd.DataFrame(data)
print(df)
print(f"Sum: {df.sum().sum()}")
`);

// Interactive terminal support
const terminal = await sandbox.terminal.create({
  command: 'bash',
  cols: 80,
  rows: 24
});
```

### Vercel - Scalable Serverless Execution

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

const sandbox = await compute.sandbox.create({});

// Execute Node.js or Python
const result = await sandbox.runCode(`
console.log('Node.js version:', process.version);
console.log('Hello from Vercel!');
`);

// Up to 45 minutes execution time
// Global infrastructure deployment
```

### Daytona - Development Workspaces

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

const sandbox = await compute.sandbox.create({});

// Execute in development workspace
const result = await sandbox.runCode(`
print('Hello from Daytona!')
import sys
print(f'Python version: {sys.version}')
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

### Terminal Operations

```typescript
// Create terminal (E2B only)
const terminal = await sandbox.terminal.create({
  command: 'bash',
  cols: 80,
  rows: 24
});

// Write to terminal
await terminal.write('ls -la\n');

// Resize terminal
await terminal.resize(120, 30);

// Kill terminal
await terminal.kill();

// List terminals
const terminals = await sandbox.terminal.list();

// Get terminal by ID
const terminal = await sandbox.terminal.getById('terminal-id');
```

## Web Framework Integration

ComputeSDK provides built-in request handlers for web frameworks:

```typescript
import { handleComputeRequest } from 'computesdk';
import { e2b } from '@computesdk/e2b';

// Next.js API route
export async function POST(request: Request) {
  return handleComputeRequest({
    request,
    provider: e2b({ apiKey: process.env.E2B_API_KEY })
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
- `compute.sandbox.terminal.create` - Create terminal
- `compute.sandbox.terminal.list` - List terminals
- `compute.sandbox.terminal.getById` - Get terminal by ID
- `compute.sandbox.terminal.destroy` - Destroy terminal
- `compute.sandbox.terminal.write` - Write to terminal
- `compute.sandbox.terminal.resize` - Resize terminal
- `compute.sandbox.terminal.kill` - Kill terminal

## Frontend Integration

Use `@computesdk/ui` for React hooks and utilities:

```typescript
import { useCompute } from '@computesdk/ui';

function CodeExecutor() {
  const compute = useCompute({
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
  const sandbox = await compute.sandbox.create({});
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

const sandbox = await compute.sandbox.create({});

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
import { vercel } from '@computesdk/vercel';
import { daytona } from '@computesdk/daytona';

async function processData(provider: any) {
  compute.setConfig({ provider });
  
  const sandbox = await compute.sandbox.create({});
  
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
const vercelResult = await processData(vercel({ runtime: 'python' }));
console.log('Vercel result:', vercelResult);

const daytonaResult = await processData(daytona({ runtime: 'python' }));
console.log('Daytona result:', daytonaResult);
```

## Provider Packages

ComputeSDK uses separate provider packages:

```bash
npm install @computesdk/e2b        # E2B provider
npm install @computesdk/vercel     # Vercel provider  
npm install @computesdk/daytona    # Daytona provider
```

Each provider implements the same interface but may support different capabilities (filesystem, terminal, etc.).

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
| **E2B** | Python, Node.js | ✅ Full | ✅ PTY | Data science, AI/ML, interactive development |
| **Vercel** | Node.js, Python | ✅ Full | ❌ | Web apps, APIs, serverless functions |
| **Daytona** | Python, Node.js | ✅ Full | ❌ | Development workspaces, custom environments |

### Key Differences

- **E2B**: Full development environment with data science libraries and interactive terminals
- **Vercel**: Ephemeral sandboxes optimized for serverless execution (up to 45 minutes)
- **Daytona**: Development workspaces with persistent environments

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
