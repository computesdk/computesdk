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

## Quick Start

```typescript
import { vercel } from '@computesdk/vercel';

const compute = vercel({
  token: process.env.VERCEL_TOKEN,
  teamId: process.env.VERCEL_TEAM_ID,
  projectId: process.env.VERCEL_PROJECT_ID,
  timeout: 600000 // 10 minutes
});

const sandbox = await compute.instances.create();

const result = await sandbox.runCommand('node -e "console.log(\"Hello from Vercel!\")"');
console.log(result.stdout);

await sandbox.destroy();
```

OIDC tokens (`VERCEL_OIDC_TOKEN`) are auto-detected from the environment when no explicit credentials are provided in config.

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
  /** Execution timeout in milliseconds */
  timeout?: number;
  /** Ports to expose */
  ports?: number[];
  /** Optional-daemond SSE port (defaults to 38989); false disables port exposure, not runtime selection */
  daemonSsePort?: number | false;
}
```

## Features

- ✅ **Command Execution** - Run shell commands in the sandbox. The default `vercel/sandbox/universal` image ships Node.js 24 and Python 3.14; `runtime: 'node'` maps to Vercel's `node24` runtime and `runtime: 'python'` to `python3.13`
- ✅ **Filesystem Operations** - Native `sandbox.fs` access (read/write/mkdir/readdir/exists/remove)
- ✅ **Live Output** - `runCommand` streams stdout/stderr through Vercel's native log stream
- ✅ **Sandbox Management** - `getById` reconnects to a sandbox by name, and `list` returns running/pending sandboxes plus paused persistent ones
- ✅ **Pause / Resume** - `pause()` stops a persistent sandbox (auto-snapshotting its rootfs); `resume()` starts a fresh session with the filesystem restored
- ✅ **Snapshots** - Capture the whole rootfs (no memory) and boot new sandboxes from a snapshot
- ✅ **Volumes** - Mount Vercel Drives as read-write or read-only snapshot mounts
- ✅ **Long-running Tasks** - Configurable per-session timeout (default 5 minutes; see Vercel's runtime limits for the per-plan maximum)
- ✅ **Global Infrastructure** - Runs on Vercel's global network
- ❌ **Interactive Terminals** - ComputeSDK does not expose a PTY for this provider

## API Reference

### Command Execution

```typescript
// Run Node.js code via heredoc
const result = await sandbox.runCommand(`node - <<'JS'
const data = { message: "Hello from Node.js" };
console.log(JSON.stringify(data));
JS`);

// Run Python code via heredoc
const result = await sandbox.runCommand(`python - <<'PY'
import json
data = {"message": "Hello from Python"}
print(json.dumps(data))
PY`);

// List files
const result = await sandbox.runCommand('ls -la');

// Install packages (Node.js)
const result = await sandbox.runCommand('npm install lodash');

// Install packages (Python)
const result = await sandbox.runCommand('pip install requests');

// Run scripts
const result = await sandbox.runCommand('node script.js');
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

// Get existing sandbox by name
const existing = await compute.instances.getById('sandbox-id');

// List sandboxes (running/pending, plus paused persistent sandboxes)
const sandboxes = await compute.instances.list();

// Destroy sandbox (also removes the sandbox's automatic snapshots)
await compute.instances.destroy('sandbox-id');
```

### Persistence

Sandboxes are created with `persistent: false` by default — a persistent sandbox auto-snapshots its filesystem on every `stop()`, which accrues Vercel Snapshot Storage charges. To opt in to persistence (required if you plan to resume or snapshot the sandbox later), pass `persistent: true` (or the shared `ephemeral: false` durable-sandbox selector) at create time:

```typescript
const sandbox = await compute.instances.create({ persistent: true });
```

Pause stops a persistent sandbox (snapshotting its rootfs) and resume starts a fresh session with the filesystem restored. Processes and memory do not survive a pause:

```typescript
await sandbox.pause();   // stops and auto-snapshots the persistent sandbox
await sandbox.resume();  // fresh session, filesystem restored
```

### Snapshots

`snapshot.create` captures the sandbox's whole rootfs (no memory) and stops the source; the source sandbox still exists and must be destroyed separately. Boot a new sandbox from a snapshot with `{ snapshotId }`:

```typescript
const snapshot = await compute.snapshot.create(sandbox.instanceId);
const restored = await compute.instances.create({ snapshotId: snapshot.id });
await compute.snapshot.delete(snapshot.id);
```

### Volumes

Vercel Drives are exposed through the unified volume surface. Mount a drive at create time as read-write or as a read-only snapshot:

```typescript
const volume = await compute.volume.create({ name: 'shared-data' });
const sandbox = await compute.instances.create({
  volumes: [{ volume, mountPath: '/data', readOnly: false }],
});
```

## Error Handling

```typescript
import { vercel } from '@computesdk/vercel';

try {
  const compute = vercel({ 
    token: process.env.VERCEL_TOKEN,
    teamId: process.env.VERCEL_TEAM_ID,
    projectId: process.env.VERCEL_PROJECT_ID
  });
  const sandbox = await compute.instances.create();
  
  const result = await sandbox.runCommand('invalid code');
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

## Examples

### Node.js Web Server Simulation

```typescript
import { vercel } from '@computesdk/vercel';

const compute = vercel({});
const sandbox = await compute.instances.create();

const result = await sandbox.runCommand(`node - <<'JS'
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
JS`);

console.log(result.stdout);
await sandbox.destroy();
```

### Python Data Processing

```typescript
import { vercel } from '@computesdk/vercel';

const compute = vercel({});
const sandbox = await compute.instances.create();

const result = await sandbox.runCommand(`python - <<'PY'
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
PY`);

console.log(result.stdout);
await sandbox.destroy();
```

### Filesystem Operations Pipeline

```typescript
import { vercel } from '@computesdk/vercel';

const compute = vercel({});
const sandbox = await compute.instances.create();

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
const result = await sandbox.runCommand(`python - <<'PY'
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
PY`);

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

await sandbox.destroy();
```

### Package Installation and Usage

```typescript
import { vercel } from '@computesdk/vercel';

const compute = vercel({});
const sandbox = await compute.instances.create();

// Install lodash
const installResult = await sandbox.runCommand('npm install lodash');
console.log('Install result:', installResult.stdout);

// Use lodash in code
const result = await sandbox.runCommand(`node - <<'JS'
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
JS`);

console.log(result.stdout);
await sandbox.destroy();
```

## Best Practices

1. **Authentication**: Use OIDC token method when possible for simpler setup
2. **Resource Management**: Destroy sandboxes when done; `destroy()` also removes the sandbox's automatic snapshots
3. **Error Handling**: Use try-catch blocks for robust error handling
4. **Timeouts**: Set an explicit `timeout` for long-running tasks (default 5 minutes)
5. **File Organization**: Use the filesystem API to organize project files
6. **Package Installation**: Install packages at runtime as needed

## Limitations

- **Non-persistent by default**: ComputeSDK creates Vercel sandboxes with `persistent: false` to avoid automatic snapshot-storage charges; pass `persistent: true` (or `ephemeral: false`) to reconnect, pause, resume, or snapshot
- **No Interactive Terminals**: ComputeSDK does not expose a PTY for this provider
- **Memory Limits**: Vercel provisions 2048 MB of memory per vCPU (no separate memory control at create time)
- **Execution Time**: Default session timeout is 5 minutes; the per-session maximum is 45 minutes on Hobby and 24 hours on Pro/Enterprise
- **Network Access**: Outbound network access follows Vercel's default network policy

## Support

- [Vercel Documentation](https://vercel.com/docs)
- [ComputeSDK Issues](https://github.com/computesdk/computesdk/issues)
- [Vercel Support](https://vercel.com/support)

## License

MIT
