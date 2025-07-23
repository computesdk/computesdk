# ComputeSDK

A unified abstraction layer for executing code in secure, isolated sandboxed environments across multiple cloud providers.

## Overview

ComputeSDK provides a consistent TypeScript interface for code execution across different cloud compute providers, similar to how Vercel's AI SDK abstracts LLM providers. Whether you're using E2B, Vercel, Cloudflare, or Fly.io, ComputeSDK gives you the same simple API.

## Features

- 🚀 **Multi-provider support** - E2B, Vercel, Cloudflare, Fly.io
- 📁 **Filesystem operations** - Read, write, create directories across all providers
- 🔄 **Auto-detection** - Automatically selects providers based on environment variables
- 🛡️ **Type-safe** - Full TypeScript support with comprehensive error handling
- 📦 **Modular** - Install only the providers you need
- 🔧 **Extensible** - Easy to add custom providers
- ⚡ **Performance** - Optimized for speed and reliability

## Installation

```bash
# Core SDK
npm install computesdk

# Provider packages (install only what you need)
npm install @computesdk/e2b
npm install @computesdk/vercel
npm install @computesdk/cloudflare
npm install @computesdk/fly
```

## Quick Start

### Auto-detection (Recommended)

```typescript
import { ComputeSDK } from 'computesdk';

// Automatically detects and uses the first available provider
const sandbox = ComputeSDK.createSandbox();

const result = await sandbox.execute('print("Hello World!")');
console.log(result.stdout);

await sandbox.kill();
```

### Provider-specific usage

```typescript
import { e2b } from '@computesdk/e2b';
import { executeSandbox } from 'computesdk';

const result = await executeSandbox({
  sandbox: e2b(),
  code: 'print("Hello from E2B!")'
});
```

## Provider Setup

### E2B (Fully Implemented)

```bash
# Set environment variable
export E2B_API_KEY=your_e2b_api_key
```

```typescript
import { e2b } from '@computesdk/e2b';

const sandbox = e2b({
  template: 'python', // optional, defaults to 'python'
  timeout: 300000,    // optional, defaults to 5 minutes
});

const result = await sandbox.execute(`
import numpy as np
import pandas as pd

data = {'A': [1, 2, 3], 'B': [4, 5, 6]}
df = pd.DataFrame(data)
print(df)
`);
```

### Vercel (Fully Implemented)

```bash
export VERCEL_TOKEN=your_vercel_token
export VERCEL_TEAM_ID=your_team_id
export VERCEL_PROJECT_ID=your_project_id
```

```typescript
import { vercel } from '@computesdk/vercel';

const sandbox = vercel({
  runtime: 'node',    // 'node' or 'python'
  timeout: 300000,    // optional, defaults to 5 minutes
});

const result = await sandbox.execute(`
console.log('Node.js version:', process.version);
console.log('Hello from Vercel Sandbox!');
`);
```

### Cloudflare (Fully Implemented)

```bash
# Cloudflare Workers environment required
# Set up in wrangler.toml with Durable Object bindings
```

```typescript
import { cloudflare } from '@computesdk/cloudflare';

const sandbox = cloudflare({
  env: { Sandbox: env.Sandbox }, // Durable Object binding
  runtime: 'python',             // 'python' or 'node'
  timeout: 300000,               // optional, defaults to 5 minutes
});

const result = await sandbox.execute(`
print('Hello from Cloudflare!')
import sys
print(f'Python version: {sys.version}')
`);
```

### Fly.io (Community Target)

```bash
export FLY_API_TOKEN=your_fly_token
```

## API Reference

### Core Methods

#### `ComputeSDK.createSandbox(options?)`

Creates a sandbox using auto-detection.

```typescript
const sandbox = ComputeSDK.createSandbox({
  timeout: 300000,  // 5 minutes (optional)
  runtime: 'python' // runtime preference (optional)
});
```

#### `sandbox.execute(code, runtime?)`

Executes code in the sandbox.

```typescript
const result = await sandbox.execute('print("Hello")', 'python');
// Returns: { stdout: string, stderr: string, executionTime: number }
```

#### `sandbox.getInfo()`

Gets sandbox information.

```typescript
const info = await sandbox.getInfo();
// Returns: { provider: string, sandboxId: string, status: string, ... }
```

#### `sandbox.kill()`

Terminates the sandbox.

```typescript
await sandbox.kill();
```

#### `executeSandbox(options)`

Utility function for one-off executions.

```typescript
const result = await executeSandbox({
  sandbox: e2b(),
  code: 'print("Hello")',
  runtime: 'python' // optional
});
```

### Filesystem Operations

All providers support comprehensive filesystem operations through the `sandbox.filesystem` interface:

#### `sandbox.filesystem.readFile(path)`

Reads the contents of a file.

```typescript
const content = await sandbox.filesystem.readFile('/path/to/file.txt');
console.log(content); // File contents as string
```

#### `sandbox.filesystem.writeFile(path, content)`

Writes content to a file, creating it if it doesn't exist.

```typescript
await sandbox.filesystem.writeFile('/path/to/file.txt', 'Hello World!');
```

#### `sandbox.filesystem.mkdir(path)`

Creates a directory (and parent directories if needed).

```typescript
await sandbox.filesystem.mkdir('/path/to/new/directory');
```

#### `sandbox.filesystem.readdir(path)`

Lists the contents of a directory.

```typescript
const entries = await sandbox.filesystem.readdir('/path/to/directory');
entries.forEach(entry => {
  console.log(`${entry.name} (${entry.isDirectory ? 'dir' : 'file'}) - ${entry.size} bytes`);
});
```

#### `sandbox.filesystem.exists(path)`

Checks if a file or directory exists.

```typescript
const exists = await sandbox.filesystem.exists('/path/to/check');
if (exists) {
  console.log('Path exists!');
}
```

#### `sandbox.filesystem.remove(path)`

Removes a file or directory.

```typescript
await sandbox.filesystem.remove('/path/to/delete');
```

## Error Handling

ComputeSDK provides comprehensive error handling:

```typescript
import { 
  ExecutionError, 
  TimeoutError, 
  AuthenticationError,
  QuotaExceededError 
} from 'computesdk';

try {
  const result = await sandbox.execute('invalid python code');
} catch (error) {
  if (error instanceof ExecutionError) {
    console.error('Code execution failed:', error.message);
  } else if (error instanceof TimeoutError) {
    console.error('Execution timed out');
  } else if (error instanceof AuthenticationError) {
    console.error('Check your API keys');
  }
}
```

## Examples

### Data Science with E2B

```typescript
import { e2b } from '@computesdk/e2b';

const sandbox = e2b();

const result = await sandbox.execute(`
import matplotlib.pyplot as plt
import numpy as np

# Generate data
x = np.linspace(0, 10, 100)
y = np.sin(x)

# Create plot
plt.figure(figsize=(10, 6))
plt.plot(x, y, 'b-', linewidth=2)
plt.title('Sine Wave')
plt.xlabel('x')
plt.ylabel('sin(x)')
plt.grid(True)
plt.savefig('sine_wave.png')
plt.show()

print("Plot saved as sine_wave.png")
`);

console.log(result.stdout);
```

### Filesystem Operations

```typescript
import { e2b } from '@computesdk/e2b';

const sandbox = e2b();

// Create a directory structure
await sandbox.filesystem.mkdir('/project/data');
await sandbox.filesystem.mkdir('/project/output');

// Write configuration file
const config = JSON.stringify({
  name: 'My Project',
  version: '1.0.0',
  settings: { debug: true }
}, null, 2);

await sandbox.filesystem.writeFile('/project/config.json', config);

// Create a Python script
const script = `
import json
import os

# Read configuration
with open('/project/config.json', 'r') as f:
    config = json.load(f)

print(f"Project: {config['name']} v{config['version']}")

# Process data
data = [1, 2, 3, 4, 5]
result = sum(data)

# Write results
with open('/project/output/results.txt', 'w') as f:
    f.write(f"Sum: {result}\\n")
    f.write(f"Count: {len(data)}\\n")

print("Processing complete!")
`;

await sandbox.filesystem.writeFile('/project/process.py', script);

// Execute the script
const result = await sandbox.execute('python /project/process.py');
console.log(result.stdout);

// Read the results
const results = await sandbox.filesystem.readFile('/project/output/results.txt');
console.log('Results:', results);

// List all files in the project
const files = await sandbox.filesystem.readdir('/project');
console.log('Project files:');
files.forEach(file => {
  console.log(`  ${file.name} (${file.isDirectory ? 'directory' : 'file'})`);
});

await sandbox.kill();
```

### Cross-Provider Filesystem Example

```typescript
import { vercel } from '@computesdk/vercel';
import { cloudflare } from '@computesdk/cloudflare';

// Works identically across providers
async function processData(sandbox: any) {
  // Create workspace
  await sandbox.filesystem.mkdir('/workspace');
  
  // Write input data
  await sandbox.filesystem.writeFile('/workspace/input.json', 
    JSON.stringify({ numbers: [1, 2, 3, 4, 5] })
  );
  
  // Process with code execution
  const result = await sandbox.execute(`
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
  return JSON.parse(output);
}

// Use with any provider
const vercelSandbox = vercel();
const vercelResult = await processData(vercelSandbox);
console.log('Vercel result:', vercelResult);

const cloudflareSandbox = cloudflare({ env });
const cloudflareResult = await processData(cloudflareSandbox);
console.log('Cloudflare result:', cloudflareResult);
```

## Development

### Package Structure

```
computesdk/                    # Main SDK package
├── @computesdk/e2b           # E2B provider
├── @computesdk/vercel        # Vercel provider
├── @computesdk/cloudflare    # Cloudflare provider
└── @computesdk/fly           # Fly.io provider
```

### Building

```bash
# Install dependencies
pnpm install

# Build all packages
pnpm build

# Run tests
pnpm test

# Run examples
cd examples/basic && pnpm run e2b
```

### Creating Custom Providers

```typescript
import { BaseProvider, ComputeSpecification } from 'computesdk';

class MyProvider extends BaseProvider implements ComputeSpecification {
  specificationVersion = 'v1' as const;
  provider = 'my-provider';
  
  async doExecute(code: string) {
    // Implementation
  }
  
  async doKill() {
    // Implementation  
  }
  
  async doGetInfo() {
    // Implementation
  }
}

export function myProvider(options = {}) {
  return new MyProvider(options);
}
```

## Provider Status

| Provider | Status | Code Execution | Filesystem | Terminal | Features |
|----------|--------|----------------|------------|----------|----------|
| **E2B** | ✅ Complete | ✅ Python | ✅ Native | ✅ PTY | Data science libraries, interactive terminals |
| **Vercel** | ✅ Complete | ✅ Node.js, Python | ✅ Shell-based | ❌ | Global deployment, up to 45min runtime |
| **Cloudflare** | ✅ Complete | ✅ Python, Node.js | ✅ Hybrid | ❌ | Global edge, container-based |
| **Fly.io** | 🎯 Community | ✅ Mock | ❌ | ❌ | Docker containers, regional deployment |

### Feature Matrix

- **✅ Complete**: Fully implemented and tested
- **🎯 Community**: Available for community contribution
- **❌ Not Available**: Not supported by the provider

## Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

MIT License - see the [LICENSE](LICENSE) file for details.

## Support

- [GitHub Issues](https://github.com/computesdk/computesdk/issues)
- [Documentation](https://github.com/computesdk/computesdk)
- [Examples](./examples)
# Test pre-commit
# Test
