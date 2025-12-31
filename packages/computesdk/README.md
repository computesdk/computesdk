# computesdk

The gateway SDK for running code in remote sandboxes. Zero-config auto-detection with support for E2B, Modal, Railway, Daytona, Vercel, and more.

## Installation

```bash
npm install computesdk
```

## Quick Start

### Zero-Config Mode (Recommended)

Set your provider credentials as environment variables and ComputeSDK automatically detects and configures everything:

```bash
export E2B_API_KEY=your_e2b_api_key
```

```typescript
import { compute } from 'computesdk';

// Auto-detects E2B from environment
const sandbox = await compute.sandbox.create();

// Execute code
const result = await sandbox.runCode('print("Hello World!")');
console.log(result.stdout); // "Hello World!"

// Clean up
await sandbox.destroy();
```

### Explicit Configuration

For more control, use `setConfig()` to explicitly configure the provider:

```typescript
import { compute } from 'computesdk';

compute.setConfig({
  provider: 'e2b',
  e2b: { apiKey: 'your_api_key' }
});

const sandbox = await compute.sandbox.create();
```

## Supported Providers

ComputeSDK automatically detects providers based on environment variables:

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

When using zero-config mode, ComputeSDK detects providers in this order:

**E2B → Railway → Daytona → Modal → Runloop → Vercel → Cloudflare → CodeSandbox**

You can force a specific provider:

```bash
export COMPUTESDK_PROVIDER=modal
```

## API Reference

### Configuration

#### `compute.setConfig(config)`

Configure the gateway with explicit provider settings.

```typescript
compute.setConfig({
  provider: 'e2b',
  e2b: { apiKey: 'your_api_key' }
});
```

**Provider-specific configs:**

```typescript
// E2B
compute.setConfig({
  provider: 'e2b',
  e2b: { 
    apiKey: 'e2b_xxx',
    templateId: 'optional_template' 
  }
});

// Modal
compute.setConfig({
  provider: 'modal',
  modal: { 
    tokenId: 'ak-xxx',
    tokenSecret: 'as-xxx'
  }
});

// Railway
compute.setConfig({
  provider: 'railway',
  railway: { 
    apiToken: 'your_token',
    projectId: 'project_id',
    environmentId: 'env_id'
  }
});

// Daytona
compute.setConfig({
  provider: 'daytona',
  daytona: { apiKey: 'your_api_key' }
});

// Vercel
compute.setConfig({
  provider: 'vercel',
  vercel: { 
    token: 'your_token',
    teamId: 'team_xxx',
    projectId: 'prj_xxx'
  }
});
```

### Sandbox Management

#### `compute.sandbox.create(options?)`

Create a new sandbox.

```typescript
const sandbox = await compute.sandbox.create();

// With options
const sandbox = await compute.sandbox.create({
  runtime: 'python',
  timeout: 300000, // 5 minutes
  metadata: { userId: '123' }
});
```

**Options:**
- `runtime?: 'node' | 'python'` - Runtime environment (default: 'node')
- `timeout?: number` - Timeout in milliseconds
- `metadata?: Record<string, any>` - Custom metadata
- `envs?: Record<string, string>` - Environment variables

#### `compute.sandbox.getById(sandboxId)`

Get an existing sandbox by ID.

```typescript
const sandbox = await compute.sandbox.getById('sandbox-id');
```

#### `compute.sandbox.list()`

List all active sandboxes.

```typescript
const sandboxes = await compute.sandbox.list();
```

### Sandbox Operations

#### `sandbox.runCode(code, runtime?)`

Execute code in the sandbox.

```typescript
const result = await sandbox.runCode('print("Hello")', 'python');
console.log(result.stdout); // "Hello"
console.log(result.stderr);
console.log(result.exitCode);
```

#### `sandbox.runCommand(command, args?)`

Run a shell command.

```typescript
const result = await sandbox.runCommand('npm', ['install', 'express']);
console.log(result.stdout);
```

#### `sandbox.getInfo()`

Get sandbox information.

```typescript
const info = await sandbox.getInfo();
console.log(info.id);
console.log(info.status); // 'running' | 'stopped' | 'error'
console.log(info.createdAt);
```

#### `sandbox.destroy()`

Destroy the sandbox and clean up resources.

```typescript
await sandbox.destroy();
```

### Filesystem Operations

The sandbox provides full filesystem access:

#### `sandbox.filesystem.writeFile(path, content)`

Write a file to the sandbox.

```typescript
await sandbox.filesystem.writeFile('/tmp/hello.py', 'print("Hello World")');
```

#### `sandbox.filesystem.readFile(path)`

Read a file from the sandbox.

```typescript
const content = await sandbox.filesystem.readFile('/tmp/hello.py');
console.log(content); // 'print("Hello World")'
```

#### `sandbox.filesystem.mkdir(path)`

Create a directory.

```typescript
await sandbox.filesystem.mkdir('/tmp/mydir');
```

#### `sandbox.filesystem.readdir(path)`

List directory contents.

```typescript
const files = await sandbox.filesystem.readdir('/tmp');
console.log(files); // [{ name: 'hello.py', type: 'file', size: 123 }, ...]
```

#### `sandbox.filesystem.exists(path)`

Check if a file or directory exists.

```typescript
const exists = await sandbox.filesystem.exists('/tmp/hello.py');
console.log(exists); // true
```

#### `sandbox.filesystem.remove(path)`

Remove a file or directory.

```typescript
await sandbox.filesystem.remove('/tmp/hello.py');
```

## Examples

### Data Science Workflow

```typescript
import { compute } from 'computesdk';

// Assumes E2B_API_KEY is set in environment
const sandbox = await compute.sandbox.create({ runtime: 'python' });

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

# Save results
import json
results = {
    'total_people': len(df),
    'average_age': avg_age,
    'cities': df['city'].unique().tolist()
}

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

### Multi-Step Build Process

```typescript
import { compute } from 'computesdk';

const sandbox = await compute.sandbox.create({ runtime: 'node' });

// Create project structure
await sandbox.filesystem.mkdir('/app');
await sandbox.filesystem.mkdir('/app/src');

// Write package.json
await sandbox.filesystem.writeFile('/app/package.json', JSON.stringify({
  name: 'my-app',
  version: '1.0.0',
  dependencies: {
    'express': '^4.18.0'
  }
}, null, 2));

// Write source code
await sandbox.filesystem.writeFile('/app/src/index.js', `
const express = require('express');
const app = express();

app.get('/', (req, res) => {
  res.json({ message: 'Hello World!' });
});

console.log('Server ready!');
`);

// Install dependencies
const installResult = await sandbox.runCommand('npm', ['install'], { cwd: '/app' });
console.log('Install:', installResult.stdout);

// Run the app
const runResult = await sandbox.runCode(`
const { spawn } = require('child_process');
const proc = spawn('node', ['src/index.js'], { cwd: '/app' });
proc.stdout.on('data', (data) => console.log(data.toString()));
`);

console.log(runResult.stdout);

await sandbox.destroy();
```

### Using Different Providers

```typescript
import { compute } from 'computesdk';

// Use E2B for data science
compute.setConfig({
  provider: 'e2b',
  e2b: { apiKey: process.env.E2B_API_KEY }
});

const e2bSandbox = await compute.sandbox.create();
await e2bSandbox.runCode('import pandas as pd; print(pd.__version__)');
await e2bSandbox.destroy();

// Switch to Modal for GPU workloads
compute.setConfig({
  provider: 'modal',
  modal: { 
    tokenId: process.env.MODAL_TOKEN_ID,
    tokenSecret: process.env.MODAL_TOKEN_SECRET
  }
});

const modalSandbox = await compute.sandbox.create();
await modalSandbox.runCode('import torch; print(torch.cuda.is_available())');
await modalSandbox.destroy();
```

## Error Handling

```typescript
try {
  const sandbox = await compute.sandbox.create();
  const result = await sandbox.runCode('invalid python code');
} catch (error) {
  console.error('Execution failed:', error.message);
  
  // Check for specific error types
  if (error.message.includes('No provider detected')) {
    console.error('Set provider credentials in environment variables');
  }
}
```

## Direct Mode (Advanced)

For advanced use cases where you want to bypass the gateway and use provider SDKs directly, see individual provider packages:

- **[@computesdk/e2b](../e2b)** - E2B provider
- **[@computesdk/modal](../modal)** - Modal provider
- **[@computesdk/railway](../railway)** - Railway provider
- **[@computesdk/daytona](../daytona)** - Daytona provider

Example direct mode usage:

```typescript
import { e2b } from '@computesdk/e2b';

const compute = e2b({ apiKey: 'your_api_key' });
const sandbox = await compute.sandbox.create();
```

## Building Custom Providers

Want to add support for a new compute provider? See **[@computesdk/provider](../provider)** for the provider framework and documentation on building custom providers.

## TypeScript Support

Full TypeScript support with comprehensive type definitions:

```typescript
import type { 
  Sandbox,
  SandboxInfo,
  CodeResult,
  CommandResult,
  CreateSandboxOptions
} from 'computesdk';
```

## License

MIT
