# @computesdk/codesandbox

CodeSandbox provider for ComputeSDK - Execute code in secure, isolated CodeSandbox environments with full filesystem and development environment support.

## Installation

```bash
npm install @computesdk/codesandbox
```

## Setup

1. Get your CodeSandbox API key from [codesandbox.io/t/api](https://codesandbox.io/t/api)
2. Set the environment variable:

```bash
export CSB_API_KEY=your_api_key_here
```

## Usage

### With ComputeSDK

```typescript
import { createCompute } from 'computesdk';
import { codesandbox } from '@computesdk/codesandbox';

// Set as default provider
const compute = createCompute({ 
  provider: codesandbox({ apiKey: process.env.CSB_API_KEY }) 
});

// Create sandbox
const sandbox = await compute.sandbox.create();

// Execute JavaScript/Node.js code
const result = await sandbox.runCode(`
const message = "Hello from CodeSandbox!";
console.log(message);

const data = { users: 3, tasks: 15 };
console.log(JSON.stringify(data, null, 2));
`);

console.log(result.stdout);
// Output:
// Hello from CodeSandbox!
// {
//   "users": 3,
//   "tasks": 15
// }

// Execute Python code
const pythonResult = await sandbox.runCode(`
import json
data = {"framework": "CodeSandbox", "language": "Python"}
print(json.dumps(data, indent=2))
print(f"Running in: {data['framework']}")
`, 'python');

console.log(pythonResult.stdout);
// Output:
// {
//   "framework": "CodeSandbox",
//   "language": "Python"
// }
// Running in: CodeSandbox

// Clean up
await compute.sandbox.destroy(sandbox.sandboxId);
```

### Direct Usage

```typescript
import { codesandbox } from '@computesdk/codesandbox';

// Create provider
const provider = codesandbox({ 
  apiKey: 'your_api_key',
  templateId: 'universal', // Optional: specify template
  timeout: 600000 // 10 minutes
});

// Use with compute singleton
const sandbox = await compute.sandbox.create({ provider });
```

## Configuration

### Environment Variables

```bash
export CSB_API_KEY=your_api_key_here
```

### Configuration Options

```typescript
interface CodesandboxConfig {
  /** CodeSandbox API key - if not provided, will use CSB_API_KEY env var */
  apiKey?: string;
  /** Template to use for new sandboxes (defaults to universal template) */
  templateId?: string;
  /** Default runtime environment */
  runtime?: 'python' | 'node';
  /** Execution timeout in milliseconds */
  timeout?: number;
}
```

## Features

- ✅ **Code Execution** - Python and Node.js runtime support
- ✅ **Command Execution** - Run shell commands in sandbox
- ✅ **Filesystem Operations** - Full file system access via CodeSandbox API
- ✅ **Template Support** - Create sandboxes from custom templates
- ✅ **Auto Runtime Detection** - Automatically detects Python vs Node.js
- ✅ **Development Environment** - Full development setup with package managers
- ✅ **Persistence** - Files persist across hibernation/resume cycles
- ✅ **Snapshot/Resume** - Fast sandbox restoration from snapshots

## API Reference

### Code Execution

```typescript
// Execute Node.js code
const result = await sandbox.runCode(`
const fs = require('fs');
const data = { timestamp: Date.now() };
console.log('Processing data:', JSON.stringify(data));
`);

// Execute Python code  
const result = await sandbox.runCode(`
import datetime
import json

data = {'timestamp': datetime.datetime.now().isoformat()}
print('Processing data:', json.dumps(data))
`, 'python');

// Auto-detection (based on code patterns)
const result = await sandbox.runCode('print("Auto-detected as Python")');
```

### Command Execution

```typescript
// List files
const result = await sandbox.runCommand('ls', ['-la']);

// Install Node.js packages
const result = await sandbox.runCommand('npm', ['install', 'lodash']);

// Install Python packages
const result = await sandbox.runCommand('pip', ['install', 'requests']);

// Run development server
const result = await sandbox.runCommand('npm', ['run', 'dev']);
```

### Filesystem Operations

```typescript
// Write file
await sandbox.filesystem.writeFile('/project/workspace/app.js', `
const express = require('express');
const app = express();

app.get('/', (req, res) => {
  res.json({ message: 'Hello from CodeSandbox!' });
});

app.listen(3000, () => {
  console.log('Server running on port 3000');
});
`);

// Read file
const content = await sandbox.filesystem.readFile('/project/workspace/package.json');

// Create directory
await sandbox.filesystem.mkdir('/project/workspace/src');

// List directory contents
const files = await sandbox.filesystem.readdir('/project/workspace');

// Check if file exists
const exists = await sandbox.filesystem.exists('/project/workspace/app.js');

// Remove file or directory
await sandbox.filesystem.remove('/project/workspace/temp.txt');
```

### Sandbox Management

```typescript
// Get sandbox info
const info = await sandbox.getInfo();
console.log(info.id, info.provider, info.status);

// Resume existing sandbox
const existing = await compute.sandbox.getById(provider, 'sandbox-id');

// Hibernate sandbox (saves state)
await compute.sandbox.destroy(provider, 'sandbox-id'); // Actually hibernates

// Note: CodeSandbox doesn't support listing all sandboxes
// Each sandbox is managed individually
```

## Best Practices

1. **Resource Management**: Use hibernation instead of destroying sandboxes to preserve state
2. **Error Handling**: Use try-catch blocks for robust error handling
3. **Timeouts**: Set appropriate timeouts for long-running tasks
4. **File Organization**: Organize files in `/project/workspace/` directory
5. **Template Usage**: Use appropriate templates for your project type
6. **API Key Security**: Never commit API keys to version control
7. **Snapshot Management**: Leverage CodeSandbox's snapshot/resume capabilities

## Support

- [CodeSandbox Documentation](https://codesandbox.io/docs/sdk)
- [ComputeSDK Issues](https://github.com/computesdk/computesdk/issues)
- [CodeSandbox Support](https://codesandbox.io/support)

## License

MIT