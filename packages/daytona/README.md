# @computesdk/daytona

Daytona provider for ComputeSDK - Execute code in Daytona development workspaces.

## Installation

```bash
npm install @computesdk/daytona
```

## Usage

### With ComputeSDK

```typescript
import { createCompute } from 'computesdk';
import { daytona } from '@computesdk/daytona';

// Set as default provider
const compute = createCompute({ 
  provider: daytona({ apiKey: process.env.DAYTONA_API_KEY }) 
});

// Create sandbox
const sandbox = await compute.sandbox.create({});

// Execute code
const result = await sandbox.runCode('print("Hello from Daytona!")');
console.log(result.stdout); // "Hello from Daytona!"

// Clean up
await compute.sandbox.destroy(sandbox.sandboxId);
```

### Direct Usage

```typescript
import { daytona } from '@computesdk/daytona';

// Create provider
const provider = daytona({ 
  apiKey: 'your-api-key',
  runtime: 'python' 
});

// Use with compute singleton
const sandbox = await compute.sandbox.create({ provider });
```

## Configuration

### Environment Variables

```bash
export DAYTONA_API_KEY=your_api_key_here
```

### Configuration Options

```typescript
interface DaytonaConfig {
  /** Daytona API key - if not provided, will use DAYTONA_API_KEY env var */
  apiKey?: string;
  /** Default runtime environment */
  runtime?: 'python' | 'node';
  /** Execution timeout in milliseconds */
  timeout?: number;
}
```

## Features

- ✅ **Code Execution** - Python and Node.js runtime support
- ✅ **Command Execution** - Run shell commands in workspace
- ✅ **Filesystem Operations** - Full file system access
- ✅ **Auto Runtime Detection** - Automatically detects Python vs Node.js
- ❌ **Interactive Terminals** - Not supported by Daytona SDK

## API Reference

### Code Execution

```typescript
// Execute Python code
const result = await sandbox.runCode(`
import json
data = {"message": "Hello from Python"}
print(json.dumps(data))
`, 'python');

// Execute Node.js code  
const result = await sandbox.runCode(`
const data = { message: "Hello from Node.js" };
console.log(JSON.stringify(data));
`, 'node');

// Auto-detection (based on code patterns)
const result = await sandbox.runCode('print("Auto-detected as Python")');
```

### Command Execution

```typescript
// List files
const result = await sandbox.runCommand('ls', ['-la']);

// Install packages
const result = await sandbox.runCommand('pip', ['install', 'requests']);

// Run scripts
const result = await sandbox.runCommand('python', ['script.py']);
```

### Filesystem Operations

```typescript
// Write file
await sandbox.filesystem.writeFile('/workspace/hello.py', 'print("Hello World")');

// Read file
const content = await sandbox.filesystem.readFile('/workspace/hello.py');

// Create directory
await sandbox.filesystem.mkdir('/workspace/data');

// List directory contents
const files = await sandbox.filesystem.readdir('/workspace');

// Check if file exists
const exists = await sandbox.filesystem.exists('/workspace/hello.py');

// Remove file or directory
await sandbox.filesystem.remove('/workspace/hello.py');
```

### Sandbox Management

```typescript
// Get sandbox info
const info = await sandbox.getInfo();
console.log(info.id, info.provider, info.status);

// List all sandboxes
const sandboxes = await compute.sandbox.list(provider);

// Get existing sandbox
const existing = await compute.sandbox.getById(provider, 'sandbox-id');

// Destroy sandbox
await compute.sandbox.destroy(provider, 'sandbox-id');
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
  if (error.message.includes('Syntax error')) {
    console.error('Code has syntax errors');
  } else if (error.message.includes('authentication failed')) {
    console.error('Check your DAYTONA_API_KEY');
  } else if (error.message.includes('quota exceeded')) {
    console.error('Daytona usage limits reached');
  }
}
```

## Web Framework Integration

Use with web frameworks via the request handler:

```typescript
import { handleComputeRequest } from 'computesdk';
import { daytona } from '@computesdk/daytona';

export async function POST(request: Request) {
  return handleComputeRequest({
    request,
    provider: daytona({ apiKey: process.env.DAYTONA_API_KEY })
  });
}
```

## Examples

### Data Processing

```typescript
const result = await sandbox.runCode(`
import json

# Process data
data = [1, 2, 3, 4, 5]
result = {
    "sum": sum(data),
    "average": sum(data) / len(data),
    "max": max(data)
}

print(json.dumps(result))
`);

const output = JSON.parse(result.stdout);
console.log(output); // { sum: 15, average: 3, max: 5 }
```

### File Processing

```typescript
// Create data file
await sandbox.filesystem.writeFile('/workspace/data.json', 
  JSON.stringify({ users: ['Alice', 'Bob', 'Charlie'] })
);

// Process file
const result = await sandbox.runCode(`
import json

with open('/workspace/data.json', 'r') as f:
    data = json.load(f)

# Process users
user_count = len(data['users'])
print(f"Found {user_count} users")

# Save result
result = {"user_count": user_count, "processed": True}
with open('/workspace/result.json', 'w') as f:
    json.dump(result, f)
`);

// Read result
const resultData = await sandbox.filesystem.readFile('/workspace/result.json');
console.log(JSON.parse(resultData));
```

## License

MIT