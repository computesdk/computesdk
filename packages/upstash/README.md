# @computesdk/upstash

Upstash Box provider for ComputeSDK - Execute code in cloud sandboxes with full filesystem access, shell commands, snapshots, and preview URLs.

## Installation

```bash
npm install @computesdk/upstash
```

## Setup

1. Get your Upstash Box API key from [console.upstash.com](https://console.upstash.com/)
2. Set the environment variable:

```bash
export UPSTASH_BOX_API_KEY=your_api_key_here
```

## Quick Start

```typescript
import { upstash } from '@computesdk/upstash';

const compute = upstash({ apiKey: process.env.UPSTASH_BOX_API_KEY });

const sandbox = await compute.sandbox.create();

const result = await sandbox.runCommand(`
import pandas as pd
print(pd.__version__)
`);

console.log(result.stdout);
await sandbox.destroy();
```

## Configuration

### Environment Variables

```bash
export UPSTASH_BOX_API_KEY=your_api_key_here
```

### Configuration Options

```typescript
interface UpstashConfig {
  /** Upstash Box API key - if not provided, will use UPSTASH_BOX_API_KEY env var */
  apiKey?: string;
  /** Default runtime environment */
  runtime?: 'python' | 'node';
  /** Execution timeout in milliseconds (default: 600000) */
  timeout?: number;
}
```

## Features

- **Code Execution** - Python and Node.js runtime support
- **Command Execution** - Run shell commands in sandbox
- **Filesystem Operations** - Full file system access
- **Preview URLs** - Get publicly accessible URLs for running services
- **Snapshots** - Save and restore sandbox state
- **Auto Runtime Detection** - Automatically detects Python vs Node.js

## API Reference

### Code Execution

```typescript
// Execute Python code
const result = await sandbox.runCommand(`
import json
data = {"message": "Hello from Python"}
print(json.dumps(data))
`, 'python');

// Execute Node.js code
const result = await sandbox.runCommand(`
const data = { message: "Hello from Node.js" };
console.log(JSON.stringify(data));
`, 'node');

// Auto-detection (based on code patterns)
const result = await sandbox.runCommand('python -c "print(\"Auto-detected as Python\")"');
```

### Command Execution

```typescript
// List files
const result = await sandbox.runCommand('ls -la');

// Install packages
const result = await sandbox.runCommand('pip install requests');

// Run with environment variables
const result = await sandbox.runCommand('echo $MY_VAR', {
  env: { MY_VAR: 'hello' },
});

// Run with working directory
const result = await sandbox.runCommand('ls', { cwd: '/workspace/home/myproject' });

// Run in background
const result = await sandbox.runCommand('node server.js', { background: true });
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

### Preview URLs

```typescript
// Get a publicly accessible URL for a running service
const url = await sandbox.getUrl({ port: 3000 });
console.log(url); // https://<box-id>-3000.box.upstash.io
```

### Snapshots

```typescript
import { upstash } from '@computesdk/upstash';

const compute = upstash({ apiKey: process.env.UPSTASH_BOX_API_KEY });

// Create a snapshot of a running sandbox
const snapshot = await compute.snapshot.create(sandbox.id, {
  name: 'my-checkpoint',
});

console.log(snapshot.id, snapshot.metadata);

// Restore from a snapshot
const restored = await compute.sandbox.create({
  snapshotId: snapshot.id,
});
```

### Sandbox Management

```typescript
// Get sandbox info
const info = await sandbox.getInfo();
console.log(info.id, info.status, info.createdAt);

// Reconnect to existing sandbox
const existing = await compute.sandbox.getById('box-id');

// List all sandboxes
const sandboxes = await compute.sandbox.list();

// Destroy sandbox
await sandbox.destroy();
```

## Runtime Detection

The provider automatically detects the runtime based on code patterns:

**Python indicators:**
- `print(` statements
- `import` statements
- `def` function definitions
- Python-specific syntax (`f"`, `__`, `raise`, etc.)

**Default:** Node.js for all other cases

## Error Handling

```typescript
import { upstash } from '@computesdk/upstash';

try {
  const compute = upstash({ apiKey: process.env.UPSTASH_BOX_API_KEY });
  const sandbox = await compute.sandbox.create();

  const result = await sandbox.runCommand('invalid code');
} catch (error) {
  if (error.message.includes('Missing Upstash Box API key')) {
    console.error('Set UPSTASH_BOX_API_KEY environment variable');
  } else if (error.message.includes('authentication failed')) {
    console.error('Check your Upstash Box API key');
  } else if (error.message.includes('quota exceeded')) {
    console.error('Upstash usage limits reached');
  }
}
```

## Examples

### Data Science Workflow

```typescript
import { upstash } from '@computesdk/upstash';

const compute = upstash({ apiKey: process.env.UPSTASH_BOX_API_KEY });
const sandbox = await compute.sandbox.create();

// Create project structure
await sandbox.filesystem.mkdir('/analysis/data');
await sandbox.filesystem.mkdir('/analysis/output');

// Write input data
const csvData = `name,age,city
Alice,25,New York
Bob,30,San Francisco
Charlie,35,Chicago`;

await sandbox.filesystem.writeFile('/analysis/data/people.csv', csvData);

// Process data with Python
const result = await sandbox.runCommand(`
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
plt.savefig('/analysis/output/age_chart.png')
print("\\nChart saved!")
`);

console.log(result.stdout);

await sandbox.destroy();
```

### Web Server with Preview URL

```typescript
import { upstash } from '@computesdk/upstash';

const compute = upstash({ apiKey: process.env.UPSTASH_BOX_API_KEY });
const sandbox = await compute.sandbox.create();

// Write a simple server
await sandbox.filesystem.writeFile('/server.js', `
const http = require('http');
const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ status: 'ok' }));
});
server.listen(3000, () => console.log('Server running on port 3000'));
`);

// Start server in background
await sandbox.runCommand('node /server.js', { background: true });

// Get the public URL
const url = await sandbox.getUrl({ port: 3000 });
console.log('Server available at:', url);

await sandbox.destroy();
```

## Best Practices

1. **Resource Management**: Always destroy sandboxes when done to free resources
2. **Error Handling**: Use try-catch blocks for robust error handling
3. **Timeouts**: Set appropriate timeouts for long-running tasks (default is 10 minutes)
4. **File Paths**: All paths are resolved relative to `/workspace/home`
5. **Snapshots**: Use snapshots to save and restore sandbox state for reproducible environments
6. **API Key Security**: Never commit API keys to version control

## Limitations

- **File Paths**: All filesystem operations are scoped under `/workspace/home`
- **Memory Limits**: Subject to Upstash Box resource constraints
- **Snapshot Deletion**: Snapshot deletion requires a box context
- **Template Support**: Use snapshots instead of templates for saving box state

## Support

- [Upstash Documentation](https://upstash.com/docs)
- [ComputeSDK Issues](https://github.com/computesdk/computesdk/issues)
- [Upstash Console](https://console.upstash.com/)

## License

MIT
