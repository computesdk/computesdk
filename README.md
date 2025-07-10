# ComputeSDK

A unified abstraction layer for executing code in secure, isolated sandboxed environments across multiple cloud providers.

## Overview

ComputeSDK provides a consistent TypeScript interface for code execution across different cloud compute providers, similar to how Vercel's AI SDK abstracts LLM providers. Whether you're using E2B, Vercel, Cloudflare, or Fly.io, ComputeSDK gives you the same simple API.

## Features

- 🚀 **Multi-provider support** - E2B, Vercel, Cloudflare, Fly.io
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

### Cloudflare (Coming Soon)

```bash
export CLOUDFLARE_API_TOKEN=your_cloudflare_token
export CLOUDFLARE_ACCOUNT_ID=your_account_id
```

### Fly.io (Coming Soon)

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

### File Operations

```typescript
const result = await sandbox.execute(`
# Create a file
with open('data.txt', 'w') as f:
    f.write('Hello from ComputeSDK!')

# Read it back
with open('data.txt', 'r') as f:
    content = f.read()
    print(f"File content: {content}")

# List files
import os
print(f"Files in current directory: {os.listdir('.')}")
`);
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

| Provider | Status | Features |
|----------|--------|----------|
| E2B | ✅ Complete | Python, data science libraries, file operations |
| Vercel | ✅ Complete | Node.js, Python, global deployment, up to 45min runtime |
| Cloudflare | 🚧 Coming Soon | Container-based, global edge |
| Fly.io | 🚧 Coming Soon | Docker containers, regional deployment |

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
