# @computesdk/vercel

Vercel Sandbox provider for ComputeSDK - Execute Node.js and Python code in secure, isolated Vercel sandboxes.

## Installation

```bash
npm install @computesdk/vercel
```

## Prerequisites

Vercel provider supports two authentication methods:

### Method 1: OIDC Token (Recommended)

The simplest way to authenticate. Vercel manages token expiration automatically.

**Development:**
```bash
vercel env pull  # Downloads VERCEL_OIDC_TOKEN to .env.local
```

**Production:** Vercel automatically provides `VERCEL_OIDC_TOKEN` in your deployment environment.

### Method 2: Access Token + Team/Project IDs

Alternative method using explicit credentials:

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

### Sandbox Reconnection

```typescript
import { vercel } from '@computesdk/vercel';

// Create a new sandbox
const sandbox1 = vercel();
const result1 = await sandbox1.doExecute('console.log("First execution");');
const sandboxId = sandbox1.sandboxId;

// Later, reconnect to the same sandbox
const sandbox2 = vercel({ sandboxId });
const result2 = await sandbox2.doExecute('console.log("Reconnected!");');

// Both executions run in the same Vercel sandbox environment
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
interface VercelConfig {
  runtime?: 'node' | 'python';  // Default: 'node'
  timeout?: number;              // Default: 300000 (5 minutes)
  sandboxId?: string;            // Existing sandbox ID to reconnect to
  token?: string;                // Vercel API token (fallback to VERCEL_TOKEN)
  teamId?: string;               // Vercel team ID (fallback to VERCEL_TEAM_ID)
  projectId?: string;            // Vercel project ID (fallback to VERCEL_PROJECT_ID)
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

### Filesystem Operations

The Vercel provider supports comprehensive filesystem operations through the `filesystem` property:

#### `sandbox.filesystem.readFile(path)`

Reads the contents of a file.

```typescript
const content = await sandbox.filesystem.readFile('/vercel/sandbox/data.txt');
console.log(content);
```

#### `sandbox.filesystem.writeFile(path, content)`

Writes content to a file, creating directories as needed.

```typescript
await sandbox.filesystem.writeFile('/vercel/sandbox/output.txt', 'Hello World!');
```

#### `sandbox.filesystem.mkdir(path)`

Creates a directory and any necessary parent directories.

```typescript
await sandbox.filesystem.mkdir('/vercel/sandbox/project/data');
```

#### `sandbox.filesystem.readdir(path)`

Lists the contents of a directory.

```typescript
const entries = await sandbox.filesystem.readdir('/vercel/sandbox');
entries.forEach(entry => {
  console.log(`${entry.name} (${entry.isDirectory ? 'directory' : 'file'}) - ${entry.size} bytes`);
});
```

#### `sandbox.filesystem.exists(path)`

Checks if a file or directory exists.

```typescript
const exists = await sandbox.filesystem.exists('/vercel/sandbox/config.json');
if (exists) {
  console.log('Configuration file found!');
}
```

#### `sandbox.filesystem.remove(path)`

Removes a file or directory.

```typescript
await sandbox.filesystem.remove('/vercel/sandbox/temp.txt');
```

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

### Filesystem Operations Example

```typescript
import { vercel } from '@computesdk/vercel';

const sandbox = vercel({ runtime: 'python' });

// Create a complete data processing pipeline using filesystem operations
try {
  // 1. Set up project structure
  await sandbox.filesystem.mkdir('/vercel/sandbox/project');
  await sandbox.filesystem.mkdir('/vercel/sandbox/project/data');
  await sandbox.filesystem.mkdir('/vercel/sandbox/project/output');

  // 2. Create configuration file
  const config = {
    project_name: "Vercel Data Pipeline",
    version: "1.0.0",
    settings: {
      input_format: "json",
      output_format: "csv",
      debug: true
    }
  };
  
  await sandbox.filesystem.writeFile(
    '/vercel/sandbox/project/config.json', 
    JSON.stringify(config, null, 2)
  );

  // 3. Create sample data
  const sampleData = [
    { id: 1, name: "Alice", department: "Engineering", salary: 95000 },
    { id: 2, name: "Bob", department: "Marketing", salary: 75000 },
    { id: 3, name: "Charlie", department: "Engineering", salary: 105000 },
    { id: 4, name: "Diana", department: "Sales", salary: 85000 }
  ];

  await sandbox.filesystem.writeFile(
    '/vercel/sandbox/project/data/employees.json',
    JSON.stringify(sampleData, null, 2)
  );

  // 4. Create and execute data processing script
  const processingScript = `
import json
import csv
import os
from collections import defaultdict

# Read configuration
with open('/vercel/sandbox/project/config.json', 'r') as f:
    config = json.load(f)

print(f"Running {config['project_name']} v{config['version']}")

# Read employee data
with open('/vercel/sandbox/project/data/employees.json', 'r') as f:
    employees = json.load(f)

# Process data - calculate department statistics
dept_stats = defaultdict(list)
for emp in employees:
    dept_stats[emp['department']].append(emp['salary'])

# Calculate averages
results = []
for dept, salaries in dept_stats.items():
    avg_salary = sum(salaries) / len(salaries)
    results.append({
        'department': dept,
        'employee_count': len(salaries),
        'average_salary': round(avg_salary, 2),
        'total_salary': sum(salaries)
    })

# Sort by average salary
results.sort(key=lambda x: x['average_salary'], reverse=True)

# Write results as JSON
with open('/vercel/sandbox/project/output/department_stats.json', 'w') as f:
    json.dump(results, f, indent=2)

# Write results as CSV
with open('/vercel/sandbox/project/output/department_stats.csv', 'w', newline='') as f:
    writer = csv.DictWriter(f, fieldnames=['department', 'employee_count', 'average_salary', 'total_salary'])
    writer.writeheader()
    writer.writerows(results)

print("Processing complete!")
print(f"Generated {len(results)} department statistics")

# Print summary
for result in results:
    print(f"{result['department']}: {result['employee_count']} employees, avg salary ${result['average_salary']}")
  `;

  await sandbox.filesystem.writeFile('/vercel/sandbox/project/process.py', processingScript);

  // 5. Execute the processing script
  const result = await sandbox.doExecute('python /vercel/sandbox/project/process.py');
  console.log('Execution Output:', result.stdout);

  // 6. Read and display results
  const jsonResults = await sandbox.filesystem.readFile('/vercel/sandbox/project/output/department_stats.json');
  const csvResults = await sandbox.filesystem.readFile('/vercel/sandbox/project/output/department_stats.csv');

  console.log('JSON Results:', jsonResults);
  console.log('CSV Results:', csvResults);

  // 7. List all generated files
  const outputFiles = await sandbox.filesystem.readdir('/vercel/sandbox/project/output');
  console.log('Generated files:');
  outputFiles.forEach(file => {
    console.log(`  ${file.name} (${file.size} bytes)`);
  });

  // 8. Verify file existence
  const configExists = await sandbox.filesystem.exists('/vercel/sandbox/project/config.json');
  const resultsExist = await sandbox.filesystem.exists('/vercel/sandbox/project/output/department_stats.json');
  
  console.log(`Configuration file exists: ${configExists}`);
  console.log(`Results file exists: ${resultsExist}`);

} catch (error) {
  console.error('Pipeline failed:', error.message);
} finally {
  await sandbox.doKill();
}
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