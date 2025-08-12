# @computesdk/vercel

Vercel provider for ComputeSDK - Execute Node.js and Python code in secure, isolated Vercel sandboxes.

## Installation

```bash
npm install @computesdk/vercel
```

## Authentication

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

```bash
export VERCEL_TOKEN=your_vercel_token_here
export VERCEL_TEAM_ID=your_team_id_here
export VERCEL_PROJECT_ID=your_project_id_here
```

Get your token from [Vercel Account Tokens](https://vercel.com/account/tokens)

## Usage

### With ComputeSDK

```typescript
import { compute } from 'computesdk';
import { vercel } from '@computesdk/vercel';

// Set as default provider
compute.setConfig({ 
  provider: vercel({ runtime: 'node' }) 
});

// Create sandbox
const sandbox = await compute.sandbox.create({});

// Execute Node.js code
const result = await sandbox.runCode('console.log("Hello from Vercel!");');
console.log(result.stdout); // "Hello from Vercel!"

// Execute Python code
const pythonResult = await sandbox.runCode('print("Hello from Python!")', 'python');
console.log(pythonResult.stdout); // "Hello from Python!"

// Clean up
await compute.sandbox.destroy(sandbox.sandboxId);
```

### Direct Usage

```typescript
import { vercel } from '@computesdk/vercel';

// Create provider with explicit config
const provider = vercel({
  token: 'your-token',
  teamId: 'your-team-id', 
  projectId: 'your-project-id',
  runtime: 'python',
  timeout: 600000 // 10 minutes
});

// Use with compute singleton
const sandbox = await compute.sandbox.create({ provider });
```

## Configuration

### Environment Variables

```bash
# Method 1: OIDC Token (Recommended)
export VERCEL_OIDC_TOKEN=your_oidc_token_here

# Method 2: Traditional
export VERCEL_TOKEN=your_vercel_token_here
export VERCEL_TEAM_ID=your_team_id_here
export VERCEL_PROJECT_ID=your_project_id_here
```

### Configuration Options

```typescript
interface VercelConfig {
  /** Vercel API token - if not provided, will use VERCEL_TOKEN env var */
  token?: string;
  /** Vercel team ID - if not provided, will use VERCEL_TEAM_ID env var */
  teamId?: string;
  /** Vercel project ID - if not provided, will use VERCEL_PROJECT_ID env var */
  projectId?: string;
  /** Default runtime environment */
  runtime?: 'node' | 'python';
  /** Execution timeout in milliseconds */
  timeout?: number;
}
```

## Features

- ✅ **Code Execution** - Node.js 22 and Python 3.13 runtime support
- ✅ **Command Execution** - Run shell commands in sandbox
- ✅ **Filesystem Operations** - Full file system access via shell commands
- ✅ **Auto Runtime Detection** - Automatically detects Python vs Node.js
- ✅ **Long-running Tasks** - Up to 45 minutes execution time
- ✅ **Global Infrastructure** - Runs on Vercel's global network
- ❌ **Interactive Terminals** - Not supported by Vercel Sandbox
- ❌ **Sandbox Reconnection** - Sandboxes are ephemeral (single-use)

## API Reference

### Code Execution

```typescript
// Execute Node.js code
const result = await sandbox.runCode(`
const data = { message: "Hello from Node.js" };
console.log(JSON.stringify(data));
`, 'node');

// Execute Python code  
const result = await sandbox.runCode(`
import json
data = {"message": "Hello from Python"}
print(json.dumps(data))
`, 'python');

// Auto-detection (based on code patterns)
const result = await sandbox.runCode('print("Auto-detected as Python")');
```

### Command Execution

```typescript
// List files
const result = await sandbox.runCommand('ls', ['-la']);

// Install packages (Node.js)
const result = await sandbox.runCommand('npm', ['install', 'lodash']);

// Install packages (Python)
const result = await sandbox.runCommand('pip', ['install', 'requests']);

// Run scripts
const result = await sandbox.runCommand('node', ['script.js']);
```

### Filesystem Operations

```typescript
// Write file
await sandbox.filesystem.writeFile('/tmp/hello.py', 'print("Hello World")');

// Read file
const content = await sandbox.filesystem.readFile('/tmp/hello.py');

// Create directory
await sandbox.filesystem.mkdir('/tmp/data');

// List directory contents
const files = await sandbox.filesystem.readdir('/tmp');

// Check if file exists
const exists = await sandbox.filesystem.exists('/tmp/hello.py');

// Remove file or directory
await sandbox.filesystem.remove('/tmp/hello.py');
```

### Sandbox Management

```typescript
// Get sandbox info
const info = await sandbox.getInfo();
console.log(info.id, info.provider, info.status);

// Get existing sandbox
const existing = await compute.sandbox.getById(provider, 'sandbox-id');

// Destroy sandbox
await compute.sandbox.destroy(provider, 'sandbox-id');

// Note: Vercel doesn't support listing all sandboxes
// Each sandbox is ephemeral and single-use
```

## Runtime Detection

The provider automatically detects the runtime based on code patterns:

**Python indicators:**
- `print(` statements
- `import` statements  
- `def` function definitions
- Python-specific syntax (`f"`, `__`, etc.)

**Default:** Node.js for all other cases

## Error Handling

```typescript
try {
  const result = await sandbox.runCode('invalid code');
} catch (error) {
  if (error.message.includes('Missing Vercel authentication')) {
    console.error('Set VERCEL_OIDC_TOKEN or VERCEL_TOKEN environment variables');
  } else if (error.message.includes('authentication failed')) {
    console.error('Check your Vercel credentials');
  } else if (error.message.includes('team/project configuration failed')) {
    console.error('Check your VERCEL_TEAM_ID and VERCEL_PROJECT_ID');
  } else if (error.message.includes('Syntax error')) {
    console.error('Code has syntax errors');
  }
}
```

## Web Framework Integration

Use with web frameworks via the request handler:

```typescript
import { handleComputeRequest } from 'computesdk';
import { vercel } from '@computesdk/vercel';

export async function POST(request: Request) {
  return handleComputeRequest({
    request,
    provider: vercel({ runtime: 'node' })
  });
}
```

## Examples

### Node.js Web Server Simulation

```typescript
const sandbox = await compute.sandbox.create({
  provider: vercel({ runtime: 'node' })
});

const result = await sandbox.runCode(`
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
  '/api/health': () => ({ 
    status: 'healthy', 
    timestamp: new Date().toISOString() 
  })
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
const sandbox = await compute.sandbox.create({
  provider: vercel({ runtime: 'python' })
});

const result = await sandbox.runCode(`
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

### Filesystem Operations Pipeline

```typescript
const sandbox = await compute.sandbox.create({
  provider: vercel({ runtime: 'python' })
});

// Create project structure
await sandbox.filesystem.mkdir('/tmp/project');
await sandbox.filesystem.mkdir('/tmp/project/data');
await sandbox.filesystem.mkdir('/tmp/project/output');

// Create configuration file
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
  '/tmp/project/config.json', 
  JSON.stringify(config, null, 2)
);

// Create sample data
const sampleData = [
  { id: 1, name: "Alice", department: "Engineering", salary: 95000 },
  { id: 2, name: "Bob", department: "Marketing", salary: 75000 },
  { id: 3, name: "Charlie", department: "Engineering", salary: 105000 },
  { id: 4, name: "Diana", department: "Sales", salary: 85000 }
];

await sandbox.filesystem.writeFile(
  '/tmp/project/data/employees.json',
  JSON.stringify(sampleData, null, 2)
);

// Process data
const result = await sandbox.runCode(`
import json
import csv
from collections import defaultdict

# Read configuration
with open('/tmp/project/config.json', 'r') as f:
    config = json.load(f)

print(f"Running {config['project_name']} v{config['version']}")

# Read employee data
with open('/tmp/project/data/employees.json', 'r') as f:
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
with open('/tmp/project/output/department_stats.json', 'w') as f:
    json.dump(results, f, indent=2)

# Write results as CSV
with open('/tmp/project/output/department_stats.csv', 'w', newline='') as f:
    writer = csv.DictWriter(f, fieldnames=['department', 'employee_count', 'average_salary', 'total_salary'])
    writer.writeheader()
    writer.writerows(results)

print("Processing complete!")
print(f"Generated {len(results)} department statistics")

# Print summary
for result in results:
    print(f"{result['department']}: {result['employee_count']} employees, avg salary ${result['average_salary']}")
`);

console.log('Execution Output:', result.stdout);

// Read and display results
const jsonResults = await sandbox.filesystem.readFile('/tmp/project/output/department_stats.json');
const csvResults = await sandbox.filesystem.readFile('/tmp/project/output/department_stats.csv');

console.log('JSON Results:', jsonResults);
console.log('CSV Results:', csvResults);

// List all generated files
const outputFiles = await sandbox.filesystem.readdir('/tmp/project/output');
console.log('Generated files:');
outputFiles.forEach(file => {
  console.log(`  ${file.name} (${file.size} bytes)`);
});
```

### Package Installation and Usage

```typescript
// Node.js example with package installation
const sandbox = await compute.sandbox.create({
  provider: vercel({ runtime: 'node' })
});

// Install lodash
const installResult = await sandbox.runCommand('npm', ['install', 'lodash']);
console.log('Install result:', installResult.stdout);

// Use lodash in code
const result = await sandbox.runCode(`
const _ = require('lodash');

const data = [
  { name: 'Alice', age: 25, city: 'New York' },
  { name: 'Bob', age: 30, city: 'San Francisco' },
  { name: 'Charlie', age: 35, city: 'Chicago' }
];

// Group by city
const grouped = _.groupBy(data, 'city');
console.log('Grouped by city:', JSON.stringify(grouped, null, 2));

// Calculate average age
const avgAge = _.meanBy(data, 'age');
console.log('Average age:', avgAge);

// Find oldest person
const oldest = _.maxBy(data, 'age');
console.log('Oldest person:', oldest.name);
`);

console.log(result.stdout);
```

## Best Practices

1. **Authentication**: Use OIDC token method when possible for simpler setup
2. **Resource Management**: Destroy sandboxes when done (they're ephemeral anyway)
3. **Error Handling**: Use try-catch blocks for robust error handling
4. **Timeouts**: Set appropriate timeouts for long-running tasks (up to 45 minutes)
5. **File Organization**: Use the filesystem API to organize project files
6. **Package Installation**: Install packages at runtime as needed

## Limitations

- **Ephemeral Sandboxes**: Each sandbox is single-use and cannot be reconnected to
- **No Sandbox Listing**: Vercel doesn't support listing all sandboxes
- **No Interactive Terminals**: Terminal operations are not supported
- **Memory Limits**: Subject to Vercel sandbox memory constraints (2048 MB per vCPU)
- **Execution Time**: Maximum 45 minutes execution time
- **Network Access**: Limited outbound network access

## Support

- [Vercel Documentation](https://vercel.com/docs)
- [ComputeSDK Issues](https://github.com/computesdk/computesdk/issues)
- [Vercel Support](https://vercel.com/support)

## License

MIT