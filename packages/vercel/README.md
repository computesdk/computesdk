# @computesdk/vercel

Vercel Sandbox provider for ComputeSDK - Execute Node.js and Python code in secure, isolated Vercel sandboxes.

## Installation

```bash
npm install @computesdk/vercel
```

## Prerequisites

You need the following environment variables set:

- `VERCEL_TOKEN` - Your Vercel access token (get from [Vercel Account Tokens](https://vercel.com/account/tokens))
- `VERCEL_TEAM_ID` - Your Vercel team ID
- `VERCEL_PROJECT_ID` - Your Vercel project ID

## Quick Start

### Basic Usage

```typescript
import { vercel } from '@computesdk/vercel';

// Create sandbox with default Node.js runtime
const sandbox = vercel();

// Execute Node.js code
const result = await sandbox.doExecute('console.log("Hello from Vercel!");');
console.log(result.stdout); // "Hello from Vercel!"

// Clean up
await sandbox.doKill();
```

### Python Runtime

```typescript
import { vercel } from '@computesdk/vercel';

// Create sandbox with Python runtime
const sandbox = vercel({ runtime: 'python' });

// Execute Python code
const result = await sandbox.doExecute('print("Hello from Python on Vercel!")');
console.log(result.stdout); // "Hello from Python on Vercel!"

await sandbox.doKill();
```

### With ComputeSDK

```typescript
import { vercel } from '@computesdk/vercel';
import { executeSandbox } from 'computesdk';

// One-off execution
const result = await executeSandbox({
  sandbox: vercel({ runtime: 'python' }),
  code: `
import json
import datetime

data = {
    "timestamp": datetime.datetime.now().isoformat(),
    "message": "Hello from Vercel Sandbox"
}

print(json.dumps(data, indent=2))
  `
});

console.log(result.stdout);
```

## Configuration

### Options

```typescript
interface SandboxConfig {
  runtime?: 'node' | 'python';  // Default: 'node'
  timeout?: number;              // Default: 300000 (5 minutes)
  provider?: string;             // Default: 'vercel'
}
```

### Example with Custom Configuration

```typescript
const sandbox = vercel({
  runtime: 'python',
  timeout: 600000,  // 10 minutes
});
```

## Features

### Supported Runtimes

- **Node.js 22** (`node`) - Default runtime
- **Python 3.13** (`python`) - Full Python environment

### Capabilities

- ✅ **Isolated execution** - Each sandbox runs in its own secure environment
- ✅ **Long-running tasks** - Up to 45 minutes execution time
- ✅ **Standard libraries** - Node.js and Python standard libraries included
- ✅ **Error handling** - Comprehensive error reporting
- ✅ **Stream support** - Real-time stdout/stderr capture
- ✅ **Global deployment** - Runs on Vercel's global infrastructure

### Limitations

- Maximum execution time: 45 minutes (configurable)
- Maximum 8 vCPUs per sandbox (default: 2 vCPUs)
- Memory allocation: 2048 MB per vCPU

## API Reference

### `vercel(config?)`

Creates a new Vercel sandbox provider.

**Parameters:**
- `config` (optional): Configuration object

**Returns:** `VercelProvider` instance

### `sandbox.doExecute(code, runtime?)`

Executes code in the sandbox.

**Parameters:**
- `code`: String containing the code to execute
- `runtime` (optional): Runtime to use ('node' | 'python')

**Returns:** `Promise<ExecutionResult>`

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

### `sandbox.doGetInfo()`

Gets information about the sandbox.

**Returns:** `Promise<SandboxInfo>`

```typescript
interface SandboxInfo {
  id: string;
  provider: string;
  runtime: string;
  status: 'running' | 'stopped';
  createdAt: Date;
  timeout: number;
  metadata: {
    vercelSandboxId: string;
    teamId: string;
    projectId: string;
    vcpus: number;
    region: string;
  };
}
```

### `sandbox.doKill()`

Terminates the sandbox.

**Returns:** `Promise<void>`

## Examples

### Node.js Web Server Simulation

```typescript
import { vercel } from '@computesdk/vercel';

const sandbox = vercel({ runtime: 'node' });

const result = await sandbox.doExecute(`
const http = require('http');
const url = require('url');

// Simulate API endpoints
const routes = {
  '/api/users': () => ({
    users: [
      { id: 1, name: 'Alice', role: 'Developer' },
      { id: 2, name: 'Bob', role: 'Designer' }
    ]
  }),
  '/api/health': () => ({ status: 'healthy', timestamp: new Date().toISOString() })
};

// Process request
const path = '/api/users';
const response = routes[path] ? routes[path]() : { error: 'Not found' };

console.log('Response:', JSON.stringify(response, null, 2));
`);

console.log(result.stdout);
```

### Python Data Processing

```typescript
import { vercel } from '@computesdk/vercel';

const sandbox = vercel({ runtime: 'python' });

const result = await sandbox.doExecute(`
import json
import statistics
from collections import Counter

# Sample data
sales_data = [
    {"product": "laptop", "quantity": 5, "price": 999},
    {"product": "mouse", "quantity": 20, "price": 25},
    {"product": "keyboard", "quantity": 15, "price": 75},
    {"product": "laptop", "quantity": 3, "price": 999},
    {"product": "mouse", "quantity": 10, "price": 25}
]

# Aggregate sales
product_sales = {}
for sale in sales_data:
    product = sale["product"]
    revenue = sale["quantity"] * sale["price"]
    product_sales[product] = product_sales.get(product, 0) + revenue

# Calculate statistics
revenues = list(product_sales.values())
total_revenue = sum(revenues)
avg_revenue = statistics.mean(revenues)

print(f"Total Revenue: ${total_revenue}")
print(f"Average Revenue per Product: ${avg_revenue:.2f}")
print("\\nRevenue by Product:")
for product, revenue in sorted(product_sales.items(), key=lambda x: x[1], reverse=True):
    print(f"  {product}: ${revenue}")
`);

console.log(result.stdout);
```

## Error Handling

The provider includes comprehensive error handling:

```typescript
import { vercel } from '@computesdk/vercel';

try {
  const sandbox = vercel();
  const result = await sandbox.doExecute('invalid syntax here');
} catch (error) {
  if (error.message.includes('timeout')) {
    console.error('Execution timed out');
  } else if (error.message.includes('memory')) {
    console.error('Memory limit exceeded');
  } else if (error.message.includes('authentication')) {
    console.error('Check your VERCEL_TOKEN');
  } else {
    console.error('Execution failed:', error.message);
  }
}
```

## Authentication Setup

1. **Get Vercel Token:**
   - Go to [Vercel Account Tokens](https://vercel.com/account/tokens)
   - Create a new token with appropriate permissions
   - Set as `VERCEL_TOKEN` environment variable

2. **Get Team and Project IDs:**
   - Find your team ID in the Vercel dashboard URL
   - Find your project ID in the project settings
   - Set as `VERCEL_TEAM_ID` and `VERCEL_PROJECT_ID`

3. **Environment Variables:**
   ```bash
   export VERCEL_TOKEN=your_vercel_token_here
   export VERCEL_TEAM_ID=your_team_id_here
   export VERCEL_PROJECT_ID=your_project_id_here
   ```

## Testing

Run the test suite:

```bash
npm test
```

Run tests with coverage:

```bash
npm run test:coverage
```

## Development

Build the package:

```bash
npm run build
```

Run in development mode:

```bash
npm run dev
```

## License

MIT - see LICENSE file for details.

## Support

- [GitHub Issues](https://github.com/computesdk/computesdk/issues)
- [ComputeSDK Documentation](https://github.com/computesdk/computesdk)