# ComputeSDK

A unified abstraction layer for executing code in secure, isolated sandboxed environments across multiple cloud providers.

Similar to how Vercel's AI SDK abstracts different LLM providers, ComputeSDK abstracts different compute sandbox providers into a single, consistent TypeScript interface.

## Features

- **Unified API** - Single interface for multiple sandbox providers
- **Auto-detection** - Automatically detects and uses available providers
- **Provider-agnostic** - Switch between providers without code changes
- **Type-safe** - Full TypeScript support with comprehensive type definitions
- **Extensible** - Easy to add new providers
- **Production-ready** - Built for real-world applications

## Supported Providers

- **E2B** - Python-focused code execution with templates
- **Vercel** - Node.js and Python execution on Vercel infrastructure
- **Cloudflare** - Edge computing with Cloudflare Workers and Durable Objects
- **Fly.io** - Fast boot containers (community contribution target)

## Installation

```bash
npm install computesdk
```

### Install Provider Packages

```bash
# Install the providers you need
npm install @computesdk/e2b        # E2B provider
npm install @computesdk/vercel     # Vercel provider
npm install @computesdk/cloudflare # Cloudflare provider
```

## Quick Start

### Auto-detection (Recommended)

```typescript
import { ComputeSDK } from 'computesdk';

// Automatically detects and uses available providers
const sdk = new ComputeSDK();
const sandbox = await sdk.createSandbox();

const result = await sandbox.execute('print("Hello from ComputeSDK!")');
console.log(result.stdout); // "Hello from ComputeSDK!"

await sandbox.kill();
```

### Provider-specific Usage

```typescript
import { executeSandbox } from 'computesdk';
import { e2b } from '@computesdk/e2b';

// Execute with specific provider
const result = await executeSandbox({
  sandbox: e2b(),
  code: 'print("Hello from E2B!")',
  runtime: 'python'
});

console.log(result.stdout);
```

### Multiple Providers

```typescript
import { executeSandbox } from 'computesdk';
import { e2b } from '@computesdk/e2b';
import { vercel } from '@computesdk/vercel';
import { cloudflare } from '@computesdk/cloudflare';

// Try different providers for different use cases
const providers = [
  { name: 'E2B', provider: e2b() },
  { name: 'Vercel', provider: vercel() },
  { name: 'Cloudflare', provider: cloudflare({ env }) }
];

for (const { name, provider } of providers) {
  try {
    const result = await executeSandbox({
      sandbox: provider,
      code: 'print("Hello from ' + name + '!")'
    });
    console.log(`${name}:`, result.stdout);
  } catch (error) {
    console.error(`${name} failed:`, error.message);
  }
}
```

## API Reference

### `ComputeSDK`

Main SDK class for auto-detection and management.

```typescript
const sdk = new ComputeSDK(options?: ComputeSDKOptions);
```

#### Methods

- `createSandbox(config?: SandboxConfig)` - Creates a sandbox using auto-detection
- `getAvailableProviders()` - Returns list of available providers
- `registerProvider(name: string, provider: ComputeSpecification)` - Registers a custom provider

### `executeSandbox(config: ExecutionConfig)`

Utility function for one-off code execution.

```typescript
interface ExecutionConfig {
  sandbox: ComputeSpecification;
  code: string;
  runtime?: 'python' | 'node';
  timeout?: number;
}
```

### `ExecutionResult`

Result object returned by all execution methods.

```typescript
interface ExecutionResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  executionTime: number;
  sandboxId: string;
  provider: string;
}
```

### `SandboxInfo`

Information about a sandbox instance.

```typescript
interface SandboxInfo {
  id: string;
  provider: string;
  runtime: string;
  status: 'running' | 'stopped';
  createdAt: Date;
  timeout: number;
  metadata?: Record<string, any>;
}
```

## Configuration

### Environment Variables

Each provider requires specific environment variables:

```bash
# E2B
E2B_API_KEY=your_e2b_api_key

# Vercel
VERCEL_TOKEN=your_vercel_token
VERCEL_TEAM_ID=your_team_id
VERCEL_PROJECT_ID=your_project_id

# Cloudflare (Workers environment only)
# Requires Durable Object bindings in wrangler.toml
```

### Provider Configuration

```typescript
import { ComputeSDK } from 'computesdk';
import { e2b } from '@computesdk/e2b';
import { vercel } from '@computesdk/vercel';

const sdk = new ComputeSDK({
  preferredProviders: ['e2b', 'vercel'], // Order of preference
  timeout: 300000, // Global timeout (5 minutes)
  retryAttempts: 3 // Retry failed executions
});

// Or configure providers individually
const customSandbox = e2b({
  timeout: 600000, // 10 minutes
  template: 'python-data-science'
});
```

## Examples

### Data Processing

```typescript
import { executeSandbox } from 'computesdk';
import { e2b } from '@computesdk/e2b';

const result = await executeSandbox({
  sandbox: e2b(),
  code: `
import pandas as pd
import numpy as np

# Create sample data
data = pd.DataFrame({
    'sales': [100, 150, 200, 120, 180],
    'profit': [20, 30, 45, 25, 40]
})

# Calculate metrics
total_sales = data['sales'].sum()
avg_profit = data['profit'].mean()
profit_margin = (data['profit'].sum() / total_sales) * 100

print(f"Total Sales: ${total_sales}")
print(f"Average Profit: ${avg_profit:.2f}")
print(f"Profit Margin: {profit_margin:.1f}%")
  `
});

console.log(result.stdout);
```

### Web API Simulation

```typescript
import { executeSandbox } from 'computesdk';
import { vercel } from '@computesdk/vercel';

const result = await executeSandbox({
  sandbox: vercel({ runtime: 'node' }),
  code: `
const express = require('express');
const app = express();

// Simulate API routes
const routes = {
  '/api/users': { users: ['Alice', 'Bob', 'Charlie'] },
  '/api/stats': { active: 150, total: 1000 }
};

// Process request
const path = '/api/users';
const response = routes[path] || { error: 'Not found' };

console.log('API Response:', JSON.stringify(response, null, 2));
  `
});

console.log(result.stdout);
```

### Edge Computing

```typescript
import { executeSandbox } from 'computesdk';
import { cloudflare } from '@computesdk/cloudflare';

// Within a Cloudflare Worker
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const result = await executeSandbox({
      sandbox: cloudflare({ env }),
      code: `
import json
from datetime import datetime

# Process request data
data = {
    "timestamp": datetime.now().isoformat(),
    "region": "auto",
    "processed": True
}

print(json.dumps(data))
      `
    });

    return new Response(result.stdout, {
      headers: { 'Content-Type': 'application/json' }
    });
  }
};
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
  const result = await executeSandbox({
    sandbox: e2b(),
    code: 'print("Hello World")'
  });
} catch (error) {
  if (error instanceof TimeoutError) {
    console.error('Execution timed out');
  } else if (error instanceof AuthenticationError) {
    console.error('Check your API credentials');
  } else if (error instanceof QuotaExceededError) {
    console.error('API quota exceeded');
  } else if (error instanceof ExecutionError) {
    console.error('Code execution failed:', error.stderr);
  } else {
    console.error('Unknown error:', error.message);
  }
}
```

## Provider Comparison

| Provider | Runtimes | Max Timeout | Use Cases |
|----------|----------|-------------|-----------|
| E2B | Python | 5 minutes | Data science, AI/ML |
| Vercel | Node.js, Python | 45 minutes | Web apps, APIs |
| Cloudflare | Python, Node.js | 30 seconds | Edge computing, real-time |
| Fly.io | Custom | Variable | Custom containers |

## Contributing

We welcome contributions! Please see our [Contributing Guide](https://github.com/computesdk/computesdk/blob/main/CONTRIBUTING.md) for details.

### Adding New Providers

1. Implement the `ComputeSpecification` interface
2. Add comprehensive tests
3. Include documentation and examples
4. Submit a pull request

## License

MIT - see [LICENSE](https://github.com/computesdk/computesdk/blob/main/LICENSE) for details.

## Support

- [GitHub Issues](https://github.com/computesdk/computesdk/issues)
- [Documentation](https://github.com/computesdk/computesdk)
- [Examples](https://github.com/computesdk/computesdk/tree/main/examples)

---

Made with ❤️ by the ComputeSDK team